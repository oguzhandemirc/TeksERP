// YAPTIRIM KATALOĞU (K0–K5) + zorlama + geçerlilik bitişi + planlı eylem + taksit. Ödenmiş tarih (P) bu defterden
// ve taksit kalemlerinden TÜRER (`paid-through.ts`); burada ayrı bir P kolonu yazılmaz.
// Her eylem YaptirimEylemi DEFTERİNE satırdır (sebep zorunlu); geri alma ters satırdır (GERI_AL),
// satır silinmez/düzeltilmez. Etki kiraya yazılır; eylem kendi tx'inde zili çalar (COMMIT'te).
// Her eylemin `…Tx(tx, …)` biçimi vardır (ilk ifadesi kurulum kilidi): portal onu işlem kimliği
// tx'inin içinde çağırır (src/portal/idempotency.ts); düz biçim kendi tx'ini açar + denetim yazar.
import type { PlanliEylem, Prisma, TaksitKalemi, TaksitPlani, YaptirimEylemi, YaptirimTuru } from "@prisma/client";
import { DAY_MS, ModuleKeySchema, SANCTION_LEVELS, type SanctionLevel } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, badRequest, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import { notifyDoorbell } from "./doorbell";

const LEVELS: readonly string[] = SANCTION_LEVELS;

export function requireReason(reason: string, what = "Yaptırım eylemi"): string {
  const r = reason.trim();
  if (!r) throw badRequest(`${what} için sebep zorunlu`);
  if (r.length > 500) throw badRequest("Sebep en çok 500 karakter");
  return r;
}

async function assertInstallation(tx: Tx, installationDbId: string): Promise<void> {
  const inst = await tx.kurulum.findUnique({ where: { id: installationDbId }, select: { id: true } });
  if (!inst) throw notFoundError("Kurulum");
}

export interface ApplySanctionInput {
  readonly installationDbId: string;
  readonly level: SanctionLevel;
  readonly message?: string | null;
  /** K3: geri sayım günü (0 = hemen) ya da açık tarih. */
  readonly restrictionDays?: number;
  readonly restrictionDate?: Date;
  /** K2: dondurulacak modül anahtarları. */
  readonly modules?: readonly string[];
  readonly reason: string;
  readonly actor: string;
  /** K4/K5 ikinci onayı: lisans numarası AYNEN yazılır. */
  readonly confirmation?: string;
  readonly nowMs?: number;
}

/** Eylemin parametresini doğrular ve kurar (planlı eylem de aynı yoldan geçer). */
export function buildSanctionParam(g: Omit<ApplySanctionInput, "installationDbId" | "reason" | "actor" | "confirmation">, nowMs: number): Prisma.InputJsonObject {
  const param: Record<string, Prisma.InputJsonValue> = {};
  if (g.message !== undefined && g.message !== null) {
    if (g.message.length > 500) throw badRequest("Mesaj en çok 500 karakter");
    param.mesaj = g.message;
  }
  if (g.level === "K2") {
    const modules = [...new Set(g.modules ?? [])];
    if (modules.length === 0) throw badRequest("K2 için en az bir modül seçilmeli");
    for (const m of modules) if (!ModuleKeySchema.safeParse(m).success) throw badRequest(`Modül anahtarı biçimsiz: ${m}`);
    param.moduller = modules;
  }
  if (g.level === "K3") {
    let when: number;
    if (g.restrictionDate) when = g.restrictionDate.getTime();
    else if (g.restrictionDays !== undefined && Number.isInteger(g.restrictionDays) && g.restrictionDays >= 0 && g.restrictionDays <= 3650) {
      when = nowMs + g.restrictionDays * DAY_MS;
    } else throw badRequest("K3 için geri sayım günü (0–3650) ya da tarih zorunlu");
    param.kisitlamaTarihi = new Date(when).toISOString();
  }
  return param;
}

/** Geri sayımı bundan KISA K3 AĞIR yaptırımdır (yönetici kararı f): K4 gibi yalnız yönetici + lisans no ikinci onayı. */
export const HEAVY_K3_MIN_DAYS = 7;

const restrictionAtMs = (param: Prisma.InputJsonObject): number | null =>
  typeof param.kisitlamaTarihi === "string" ? Date.parse(param.kisitlamaTarihi) : null;

/** TEK yüklem: K4 · K5 · kısıtlama anı `atMs` + 7 günden önce olan K3. Rol kapısı ve ikinci onay bunu sorar. */
export function isHeavySanction(level: string, restrictionMs: number | null, atMs: number): boolean {
  if (level === "K4" || level === "K5") return true;
  return level === "K3" && restrictionMs !== null && restrictionMs < atMs + HEAVY_K3_MIN_DAYS * DAY_MS;
}

/** Uygulanacak eylem ağır mı (portal rolü tx'ten ÖNCE sorar; parametre aynı kurucudan geçer). */
export function sanctionInputIsHeavy(g: Pick<ApplySanctionInput, "level" | "restrictionDays" | "restrictionDate">, nowMs: number): boolean {
  if (g.level !== "K3") return isHeavySanction(g.level, null, nowMs);
  return isHeavySanction(g.level, restrictionAtMs(buildSanctionParam(g, nowMs)), nowMs);
}

/**
 * Deftere yazılmış eylem ağır mıydı (geri alma da aynı rolü ister). K3'ün sınıfı YAZIM ANINDA karar
 * verilip parametrede (`agir`) donar — satırın `createdAt`i istek anından ms'ler sonra olduğu için
 * sonradan yeniden hesap sınırdaki (tam 7 gün) eylemi ağır sayardı.
 */
export function sanctionRowIsHeavy(row: Pick<YaptirimEylemi, "tur" | "parametre">): boolean {
  if (row.tur === "K4" || row.tur === "K5") return true;
  return row.tur === "K3" && (row.parametre as { agir?: unknown } | null)?.agir === true;
}

/** K3 parametresine yazım anındaki ağırlık kararını ekler (yalnız ağırsa; hafif satır değişmez). */
const markHeavy = (param: Prisma.InputJsonObject, heavy: boolean): Prisma.InputJsonObject => (heavy ? { ...param, agir: true } : param);

/** Vadesinde K3 uygulayacak planlı eylem / taksit gecikmesi: geri sayım günü 7'den kısaysa ağır. */
export const plannedK3IsHeavy = (level: string, restrictionDays: number | undefined): boolean =>
  level === "K3" && restrictionDays !== undefined && restrictionDays < HEAVY_K3_MIN_DAYS;

/** Ağır yaptırımın ikinci onayı: kurulumun lisans numarası AYNEN yazılır (kurulum kilidi altında okunur). */
async function assertSecondConfirmation(tx: Tx, installationDbId: string, what: string, confirmation: string | undefined): Promise<void> {
  const hak = await tx.hak.findFirst({ where: { kurulumId: installationDbId, aktif: true } });
  if (!hak || (confirmation ?? "").trim() !== hak.lisansNo) {
    throw new VendorError(400, "IKINCI_ONAY_GEREKLI", `${what} ikinci onay ister: kurulumun lisans numarasını aynen yazın`);
  }
}

async function writeAction(
  tx: Tx,
  g: { installationDbId: string; type: YaptirimTuru; param: Prisma.InputJsonObject; reason: string; actor: string; revertsId?: string; plannedId?: string },
): Promise<YaptirimEylemi> {
  const row = await tx.yaptirimEylemi.create({
    data: {
      kurulumId: g.installationDbId,
      tur: g.type,
      parametre: g.param,
      sebep: g.reason,
      yapan: g.actor,
      geriAlinanEylemId: g.revertsId ?? null,
      planliEylemId: g.plannedId ?? null,
    },
  });
  await notifyDoorbell(tx, g.installationDbId, "lisans");
  return row;
}

export function sanctionAudit(row: YaptirimEylemi): { event: string; entity: string; entityId: string; summary: Prisma.InputJsonObject } {
  const event = row.tur === "GERI_AL" ? "YAPTIRIM_GERI_AL" : row.tur === "ZORLAMA" || row.tur === "GECERLILIK" ? row.tur : `YAPTIRIM_${row.tur}`;
  return { event, entity: "Kurulum", entityId: row.kurulumId, summary: { eylemId: row.id, sebep: row.sebep } };
}

async function auditRow(row: YaptirimEylemi | null, actor: string): Promise<void> {
  if (row) await recordAudit({ ...sanctionAudit(row), actor });
}

export async function applySanctionTx(tx: Tx, g: ApplySanctionInput): Promise<YaptirimEylemi> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason);
  const nowMs = g.nowMs ?? Date.now();
  const param = buildSanctionParam(g, nowMs);
  await assertInstallation(tx, g.installationDbId);
  const heavy = isHeavySanction(g.level, restrictionAtMs(param), nowMs);
  if (heavy) {
    const what = g.level === "K3" ? `Geri sayımı ${HEAVY_K3_MIN_DAYS} günden kısa K3` : g.level;
    await assertSecondConfirmation(tx, g.installationDbId, what, g.confirmation);
  }
  return writeAction(tx, { installationDbId: g.installationDbId, type: g.level, param: markHeavy(param, heavy && g.level === "K3"), reason, actor: g.actor });
}

export async function applySanction(g: ApplySanctionInput): Promise<YaptirimEylemi> {
  const row = await prisma.$transaction((tx) => applySanctionTx(tx, g));
  await auditRow(row, g.actor);
  return row;
}

export async function findSanctionAction(db: Tx | typeof prisma, actionId: string): Promise<YaptirimEylemi> {
  const target = await db.yaptirimEylemi.findUnique({ where: { id: actionId } });
  if (!target) throw notFoundError("Yaptırım eylemi");
  return target;
}

/** Eylemi anında geri al: ters satır. Bir eylem yalnız bir kez geri alınır. `target` kilitsiz okunur (kurulumu değişmez). */
export async function revertSanctionTx(tx: Tx, g: { target: YaptirimEylemi; reason: string; actor: string }): Promise<YaptirimEylemi> {
  await lockInstallation(tx, g.target.kurulumId);
  const reason = requireReason(g.reason);
  if (!LEVELS.includes(g.target.tur)) throw badRequest("Yalnız K0–K5 eylemleri geri alınır (zorlama/geçerlilik ayrı eylemle değişir)");
  const already = await tx.yaptirimEylemi.findUnique({ where: { geriAlinanEylemId: g.target.id } });
  if (already) throw stateConflict("Bu eylem zaten geri alındı");
  return writeAction(tx, {
    installationDbId: g.target.kurulumId,
    type: "GERI_AL",
    param: { geriAlinanTur: g.target.tur },
    reason,
    actor: g.actor,
    revertsId: g.target.id,
  });
}

export async function revertSanction(g: { actionId: string; reason: string; actor: string }): Promise<YaptirimEylemi> {
  const target = await findSanctionAction(prisma, g.actionId);
  const row = await prisma.$transaction((tx) => revertSanctionTx(tx, { target, reason: g.reason, actor: g.actor }));
  await auditRow(row, g.actor);
  return row;
}

/** Gözlem ↔ zorla. Aynı değere geçiş no-op (satır yazmaz). */
export async function setEnforcementTx(tx: Tx, g: { installationDbId: string; enforce: boolean; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason);
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  if (inst.zorlama === g.enforce) return null;
  const claim = await tx.kurulum.updateMany({ where: { id: inst.id, zorlama: inst.zorlama }, data: { zorlama: g.enforce } });
  if (claim.count === 0) throw retryConflict();
  return writeAction(tx, { installationDbId: inst.id, type: "ZORLAMA", param: { onceki: inst.zorlama, yeni: g.enforce }, reason, actor: g.actor });
}

export async function setEnforcement(g: { installationDbId: string; enforce: boolean; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  const row = await prisma.$transaction((tx) => setEnforcementTx(tx, g));
  await auditRow(row, g.actor);
  return row;
}

async function setValidityInTx(tx: Tx, g: { installationDbId: string; validUntil: Date | null; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  const hak = await tx.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true } });
  if (!hak) throw notFoundError("Kurulumun aktif hakkı");
  const before = hak.gecerlilikBitis?.toISOString() ?? null;
  const after = g.validUntil?.toISOString() ?? null;
  if (before === after) return null;
  const claim = await tx.hak.updateMany({ where: { id: hak.id, gecerlilikBitis: hak.gecerlilikBitis }, data: { gecerlilikBitis: g.validUntil } });
  if (claim.count === 0) throw retryConflict();
  return writeAction(tx, {
    installationDbId: g.installationDbId,
    type: "GECERLILIK",
    param: { onceki: before, yeni: after },
    reason: g.reason,
    actor: g.actor,
  });
}

/** Kilit altında çağrılır (HAK sürümü "kalıcıya çevir" aynı tx'te süre sınırını kaldırır). */
export const setValidityUnderLock = setValidityInTx;

/** Vadeli geçerlilik bitişi: tarih ver (vadeli) ya da null (süre sınırı kalkar — HAK `kalici` ayrı, kök parolasıyla). */
export async function setValidityEndTx(tx: Tx, g: { installationDbId: string; validUntil: Date | null; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason);
  return setValidityInTx(tx, { ...g, reason });
}

export async function setValidityEnd(g: { installationDbId: string; validUntil: Date | null; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  const row = await prisma.$transaction((tx) => setValidityEndTx(tx, g));
  await auditRow(row, g.actor);
  return row;
}

/** N gün uzat: bitiş max(şimdi, mevcut bitiş) + N gün (mevcut bitiş kilit altında okunur). */
export async function extendValidityTx(tx: Tx, g: { installationDbId: string; days: number; reason: string; actor: string; nowMs?: number }): Promise<YaptirimEylemi | null> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason);
  if (!Number.isInteger(g.days) || g.days < 1 || g.days > 3650) throw badRequest("Uzatma günü 1–3650 olmalı");
  const hak = await tx.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true } });
  if (!hak) throw notFoundError("Kurulumun aktif hakkı");
  const base = Math.max(g.nowMs ?? Date.now(), hak.gecerlilikBitis?.getTime() ?? 0);
  return setValidityInTx(tx, { installationDbId: g.installationDbId, validUntil: new Date(base + g.days * DAY_MS), reason, actor: g.actor });
}

export async function extendValidity(g: { installationDbId: string; days: number; reason: string; actor: string; nowMs?: number }): Promise<YaptirimEylemi | null> {
  const row = await prisma.$transaction((tx) => extendValidityTx(tx, g));
  await auditRow(row, g.actor);
  return row;
}

// -----------------------------------------------------------------------------
// PLANLI EYLEM — vadesinde dakikalık iş uygular (atomik claim: BEKLIYOR → UYGULANDI)
// -----------------------------------------------------------------------------

export interface SchedulePlannedInput {
  readonly installationDbId: string;
  readonly level: SanctionLevel;
  readonly dueAt: Date;
  readonly message?: string;
  readonly restrictionDays?: number;
  readonly modules?: readonly string[];
  readonly reason: string;
  readonly actor: string;
  /** Geri sayımı 7 günden kısa K3 (ağır): lisans numarası AYNEN. */
  readonly confirmation?: string;
}

export async function schedulePlannedActionTx(tx: Tx, g: SchedulePlannedInput): Promise<PlanliEylem> {
  await lockInstallation(tx, g.installationDbId);
  const reason = requireReason(g.reason, "Planlı eylem");
  if (g.level === "K4" || g.level === "K5") throw badRequest("K4/K5 planlanamaz: ikinci onayla anında uygulanır");
  if (Number.isNaN(g.dueAt.getTime())) throw badRequest("Vade tarihi geçersiz");
  // Parametre planlama anında doğrulanır; K3 tarihi vade anına göre yeniden kurulur.
  buildSanctionParam({ level: g.level, message: g.message, restrictionDays: g.restrictionDays, modules: g.modules }, g.dueAt.getTime());
  await assertInstallation(tx, g.installationDbId);
  if (plannedK3IsHeavy(g.level, g.restrictionDays)) {
    await assertSecondConfirmation(tx, g.installationDbId, `Geri sayımı ${HEAVY_K3_MIN_DAYS} günden kısa planlı K3`, g.confirmation);
  }
  return tx.planliEylem.create({
    data: {
      kurulumId: g.installationDbId,
      tur: g.level,
      parametre: { mesaj: g.message ?? null, gun: g.restrictionDays ?? null, moduller: g.modules ? [...g.modules] : null },
      vade: g.dueAt,
      sebep: reason,
      yapan: g.actor,
    },
  });
}

export async function schedulePlannedAction(g: SchedulePlannedInput): Promise<PlanliEylem> {
  const row = await prisma.$transaction((tx) => schedulePlannedActionTx(tx, g));
  await recordAudit({ event: "PLANLI_EYLEM", entity: "PlanliEylem", entityId: row.id, actor: g.actor, summary: { tur: row.tur, vade: row.vade.toISOString() } });
  return row;
}

/** İptal bir durum geçişidir (BEKLIYOR → IPTAL, atomik): kim, ne zaman, neden satırda kalır. */
export async function cancelPlannedActionTx(tx: Tx, g: { planned: PlanliEylem; reason: string; actor: string; nowMs?: number }): Promise<PlanliEylem> {
  await lockInstallation(tx, g.planned.kurulumId);
  const reason = requireReason(g.reason, "Planlı eylem iptali");
  const claim = await tx.planliEylem.updateMany({
    where: { id: g.planned.id, durum: "BEKLIYOR" },
    data: { durum: "IPTAL", iptalZamani: new Date(g.nowMs ?? Date.now()), iptalEden: g.actor, iptalSebebi: reason },
  });
  if (claim.count === 0) throw stateConflict("Planlı eylem bekliyor durumunda değil");
  return tx.planliEylem.findUniqueOrThrow({ where: { id: g.planned.id } });
}

export async function cancelPlannedAction(g: { id: string; reason: string; actor: string }): Promise<void> {
  const planned = await prisma.planliEylem.findUnique({ where: { id: g.id } });
  if (!planned) throw notFoundError("Planlı eylem");
  await prisma.$transaction((tx) => cancelPlannedActionTx(tx, { planned, reason: g.reason, actor: g.actor }));
  await recordAudit({ event: "PLANLI_EYLEM_IPTAL", entity: "PlanliEylem", entityId: g.id, actor: g.actor, summary: { sebep: g.reason } });
}

interface PlannedParam {
  mesaj?: string | null;
  gun?: number | null;
  moduller?: string[] | null;
}

/**
 * Tek planlı eylemi uygular (atomik claim: BEKLIYOR → UYGULANDI). Aday listesi bayat olabilir
 * (iki zamanlayıcı aynı satırı görür): claim kaybeden `false` döner ve hiçbir şey yazmaz.
 */
export async function applyPlannedAction(p: PlanliEylem, nowMs: number): Promise<boolean> {
  const param = (p.parametre ?? {}) as PlannedParam;
  const sanctionParam = buildSanctionParam(
    {
      level: p.tur as SanctionLevel,
      message: param.mesaj ?? null,
      restrictionDays: param.gun ?? undefined,
      modules: param.moduller ?? undefined,
    },
    nowMs,
  );
  return prisma.$transaction(async (tx) => {
    await lockInstallation(tx, p.kurulumId);
    const claim = await tx.planliEylem.updateMany({
      where: { id: p.id, durum: "BEKLIYOR" },
      data: { durum: "UYGULANDI", uygulamaZamani: new Date(nowMs) },
    });
    if (claim.count === 0) return false;
    const heavy = plannedK3IsHeavy(p.tur, param.gun ?? undefined);
    await writeAction(tx, { installationDbId: p.kurulumId, type: p.tur, param: markHeavy(sanctionParam, heavy), reason: p.sebep, actor: `planli:${p.yapan}`, plannedId: p.id });
    // Tetiklenme bildirimi AYNI tx'te (sebep metni GİTMEZ; tür + vade).
    await enqueueNotificationTx(tx, { event: "PLANLI_EYLEM_UYGULANDI", keyParts: [p.id], installationDbId: p.kurulumId, relatedId: p.id, portalPath: `/kurulumlar/${p.kurulumId}`, referans: `Yaptırım ${p.tur}`, tarih: p.vade });
    return true;
  });
}

export async function runDuePlannedActions(nowMs: number): Promise<number> {
  const due = await prisma.planliEylem.findMany({
    where: { durum: "BEKLIYOR", vade: { lte: new Date(nowMs) } },
    orderBy: [{ vade: "asc" }, { id: "asc" }],
    take: 100,
  });
  let applied = 0;
  for (const p of due) if (await applyPlannedAction(p, nowMs)) applied++;
  return applied;
}

// -----------------------------------------------------------------------------
// TAKSİT — ödeme onayı → geçerlilik bir sonraki vadeye uzar; vade + gecikme günü ödemesiz → K3
// -----------------------------------------------------------------------------

export interface CreateInstallmentPlanInput {
  readonly installationDbId: string;
  readonly description: string;
  readonly items: readonly { dueAt: Date; amount: string }[];
  readonly extendDays?: number;
  readonly graceDays?: number;
  readonly restrictionDays?: number;
  readonly actor: string;
  /** Kısıtlama günü 7'den kısa (gecikmede ağır K3): lisans numarası AYNEN. */
  readonly confirmation?: string;
}

/** Taksit gecikmesinin K3 geri sayımı (varsayılan dahil) — rol kapısı ve servis aynı değeri sorar. */
export const installmentRestrictionDays = (restrictionDays: number | undefined): number => restrictionDays ?? 15;

const dayCount = (v: number | undefined, fallback: number, name: string): number => {
  const n = v ?? fallback;
  if (!Number.isInteger(n) || n < 0 || n > 3650) throw badRequest(`${name} 0–3650 gün olmalı`);
  return n;
};

export async function createInstallmentPlanTx(tx: Tx, g: CreateInstallmentPlanInput): Promise<TaksitPlani & { kalemler: TaksitKalemi[] }> {
  await lockInstallation(tx, g.installationDbId);
  const description = g.description.trim();
  if (!description || description.length > 500) throw badRequest("Taksit planı açıklaması 1–500 karakter olmalı");
  if (g.items.length === 0 || g.items.length > 120) throw badRequest("Taksit planında 1–120 kalem olmalı");
  for (const it of g.items) {
    if (Number.isNaN(it.dueAt.getTime())) throw badRequest("Taksit vadesi geçersiz");
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(it.amount) || Number(it.amount) <= 0) throw badRequest(`Taksit tutarı geçersiz: ${it.amount}`);
  }
  const items = [...g.items].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const extendDays = dayCount(g.extendDays, 15, "Uzatma");
  const restrictionDays = dayCount(installmentRestrictionDays(g.restrictionDays), 15, "Kısıtlama");
  await assertInstallation(tx, g.installationDbId);
  if (plannedK3IsHeavy("K3", restrictionDays)) {
    await assertSecondConfirmation(tx, g.installationDbId, `Kısıtlama günü ${HEAVY_K3_MIN_DAYS}'den kısa taksit planı`, g.confirmation);
  }
  const plan = await tx.taksitPlani.create({
    data: {
      kurulumId: g.installationDbId,
      aciklama: description,
      uzatmaGun: extendDays,
      gecikmeGun: dayCount(g.graceDays, 15, "Gecikme"),
      kisitlamaGun: restrictionDays,
      yapan: g.actor,
    },
  });
  for (const [i, item] of items.entries()) {
    await tx.taksitKalemi.create({ data: { planId: plan.id, sira: i + 1, vade: item.dueAt, tutar: item.amount } });
  }
  await setValidityInTx(tx, {
    installationDbId: g.installationDbId,
    validUntil: new Date(items[0]!.dueAt.getTime() + extendDays * DAY_MS),
    reason: `Taksit planı: ${description}`,
    actor: g.actor,
  });
  return tx.taksitPlani.findUniqueOrThrow({ where: { id: plan.id }, include: { kalemler: { orderBy: { sira: "asc" } } } });
}

export async function createInstallmentPlan(g: CreateInstallmentPlanInput): Promise<TaksitPlani & { kalemler: TaksitKalemi[] }> {
  const plan = await prisma.$transaction((tx) => createInstallmentPlanTx(tx, g));
  await recordAudit({ event: "TAKSIT_PLANI", entity: "TaksitPlani", entityId: plan.id, actor: g.actor, summary: { kurulumId: g.installationDbId, kalem: plan.kalemler.length } });
  return plan;
}

export type InstallmentItemWithPlan = TaksitKalemi & { plan: TaksitPlani };

export async function findInstallmentItem(itemId: string): Promise<InstallmentItemWithPlan> {
  const item = await prisma.taksitKalemi.findUnique({ where: { id: itemId }, include: { plan: true } });
  if (!item) throw notFoundError("Taksit kalemi");
  return item;
}

export interface InstallmentPaymentResult {
  readonly item: TaksitKalemi;
  readonly validity: YaptirimEylemi | null;
  readonly revertedK3: YaptirimEylemi | null;
}

/** Ödeme onayı: kalem ODENDI; gecikme K3'ü ters kayıtla kalkar; geçerlilik sonraki bekleyen vade + uzatmaya (son kalemde süre sınırı kalkar). */
export async function recordInstallmentPaymentTx(tx: Tx, g: { item: InstallmentItemWithPlan; actor: string; nowMs?: number }): Promise<InstallmentPaymentResult> {
  await lockInstallation(tx, g.item.plan.kurulumId);
  const installationDbId = g.item.plan.kurulumId;
  const nowMs = g.nowMs ?? Date.now();
  const claim = await tx.taksitKalemi.updateMany({
    where: { id: g.item.id, durum: { in: ["BEKLIYOR", "GECIKTI"] } },
    data: { durum: "ODENDI", odemeZamani: new Date(nowMs) },
  });
  if (claim.count === 0) throw stateConflict("Taksit zaten ödenmiş ya da iptal");
  let revertedK3: YaptirimEylemi | null = null;
  const item = await tx.taksitKalemi.findUniqueOrThrow({ where: { id: g.item.id } });
  if (item.yaptirimEylemiId) {
    const reverted = await tx.yaptirimEylemi.findUnique({ where: { geriAlinanEylemId: item.yaptirimEylemiId } });
    if (!reverted) {
      revertedK3 = await writeAction(tx, {
        installationDbId,
        type: "GERI_AL",
        param: { geriAlinanTur: "K3", sebep: "taksit ödendi" },
        reason: `Taksit ${item.sira} ödendi`,
        actor: g.actor,
        revertsId: item.yaptirimEylemiId,
      });
    }
  }
  const next = await tx.taksitKalemi.findFirst({
    where: { planId: item.planId, durum: { in: ["BEKLIYOR", "GECIKTI"] } },
    orderBy: [{ vade: "asc" }, { sira: "asc" }],
  });
  const validity = await setValidityInTx(tx, {
    installationDbId,
    validUntil: next ? new Date(next.vade.getTime() + g.item.plan.uzatmaGun * DAY_MS) : null,
    reason: next ? `Taksit ${item.sira} ödendi — sonraki vadeye uzatıldı` : "Taksit planı tamamlandı — süre sınırı kalktı",
    actor: g.actor,
  });
  // Ödenmiş tarih (P) sıradaki vadeye ilerledi: geçerlilik değişmese de çevrimiçi fabrika yeni P'li kirayı hemen alsın.
  await notifyDoorbell(tx, installationDbId, "lisans");
  return { item, validity, revertedK3 };
}

export async function recordInstallmentPayment(g: { itemId: string; actor: string; nowMs?: number }): Promise<void> {
  const item = await findInstallmentItem(g.itemId);
  await prisma.$transaction((tx) => recordInstallmentPaymentTx(tx, { item, actor: g.actor, nowMs: g.nowMs }));
  await recordAudit({ event: "TAKSIT_ODENDI", entity: "TaksitKalemi", entityId: item.id, actor: g.actor });
}

/** Planı kapatır (aktif → pasif, atomik): bekleyen kalemler IPTAL; geçerlilik bitişine DOKUNMAZ (ayrı eylem). */
export async function closeInstallmentPlanTx(tx: Tx, g: { plan: TaksitPlani; reason: string; actor: string; nowMs?: number }): Promise<TaksitPlani> {
  await lockInstallation(tx, g.plan.kurulumId);
  const reason = requireReason(g.reason, "Taksit planını kapatmak");
  const claim = await tx.taksitPlani.updateMany({
    where: { id: g.plan.id, aktif: true },
    data: { aktif: false, kapanisZamani: new Date(g.nowMs ?? Date.now()), kapatan: g.actor, kapanisSebebi: reason },
  });
  if (claim.count === 0) throw stateConflict("Taksit planı zaten kapalı");
  await tx.taksitKalemi.updateMany({ where: { planId: g.plan.id, durum: "BEKLIYOR" }, data: { durum: "IPTAL" } });
  return tx.taksitPlani.findUniqueOrThrow({ where: { id: g.plan.id } });
}

export async function runOverdueInstallments(nowMs: number): Promise<number> {
  const candidates = await prisma.taksitKalemi.findMany({
    where: { durum: "BEKLIYOR", vade: { lt: new Date(nowMs) }, plan: { aktif: true } },
    include: { plan: true },
    orderBy: [{ vade: "asc" }, { id: "asc" }],
    take: 100,
  });
  let applied = 0;
  for (const item of candidates) {
    if (item.vade.getTime() + item.plan.gecikmeGun * DAY_MS > nowMs) continue;
    const param = buildSanctionParam(
      { level: "K3", restrictionDays: item.plan.kisitlamaGun, message: `Taksit ${item.sira} ödenmedi` },
      nowMs,
    );
    const done = await prisma.$transaction(async (tx) => {
      await lockInstallation(tx, item.plan.kurulumId);
      const claim = await tx.taksitKalemi.updateMany({ where: { id: item.id, durum: "BEKLIYOR" }, data: { durum: "GECIKTI" } });
      if (claim.count === 0) return false;
      const action = await writeAction(tx, {
        installationDbId: item.plan.kurulumId,
        type: "K3",
        param: markHeavy(param, plannedK3IsHeavy("K3", item.plan.kisitlamaGun)),
        reason: `Taksit ${item.sira} vadesi + ${item.plan.gecikmeGun} gün geçti`,
        actor: "taksit",
      });
      await tx.taksitKalemi.update({ where: { id: item.id }, data: { yaptirimEylemiId: action.id } });
      await enqueueNotificationTx(tx, { event: "TAKSIT_GECIKTI", keyParts: [item.id], installationDbId: item.plan.kurulumId, relatedId: item.id, portalPath: `/kurulumlar/${item.plan.kurulumId}`, referans: `Taksit ${item.sira} · K3`, tarih: item.vade });
      return true;
    });
    if (done) applied++;
  }
  return applied;
}
