// YAPTIRIM KATALOĞU (K0–K5) + zorlama + geçerlilik bitişi + planlı eylem + taksit.
// Her eylem YaptirimEylemi DEFTERİNE satırdır (sebep zorunlu); geri alma ters satırdır (GERI_AL),
// satır silinmez/düzeltilmez. Etki kiraya yazılır; eylem kendi tx'inde zili çalar (COMMIT'te).
import type { PlanliEylem, Prisma, YaptirimEylemi, YaptirimTuru } from "@prisma/client";
import { DAY_MS, ModuleKeySchema, SANCTION_LEVELS, type SanctionLevel } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, retryConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Tx } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import { notifyDoorbell } from "./doorbell";

const LEVELS: readonly string[] = SANCTION_LEVELS;
const bad = (message: string): VendorError => new VendorError(400, "GOVDE_GECERSIZ", message);

function requireReason(reason: string): string {
  const r = reason.trim();
  if (!r) throw bad("Yaptırım eylemi için sebep zorunlu");
  if (r.length > 500) throw bad("Sebep en çok 500 karakter");
  return r;
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
    if (g.message.length > 500) throw bad("Mesaj en çok 500 karakter");
    param.mesaj = g.message;
  }
  if (g.level === "K2") {
    const modules = [...new Set(g.modules ?? [])];
    if (modules.length === 0) throw bad("K2 için en az bir modül seçilmeli");
    for (const m of modules) if (!ModuleKeySchema.safeParse(m).success) throw bad(`Modül anahtarı biçimsiz: ${m}`);
    param.moduller = modules;
  }
  if (g.level === "K3") {
    let when: number;
    if (g.restrictionDate) when = g.restrictionDate.getTime();
    else if (g.restrictionDays !== undefined && Number.isInteger(g.restrictionDays) && g.restrictionDays >= 0 && g.restrictionDays <= 3650) {
      when = nowMs + g.restrictionDays * DAY_MS;
    } else throw bad("K3 için geri sayım günü (0–3650) ya da tarih zorunlu");
    param.kisitlamaTarihi = new Date(when).toISOString();
  }
  return param;
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

export async function applySanction(g: ApplySanctionInput): Promise<YaptirimEylemi> {
  const nowMs = g.nowMs ?? Date.now();
  const reason = requireReason(g.reason);
  const param = buildSanctionParam(g, nowMs);
  if (g.level === "K4" || g.level === "K5") {
    const hak = await prisma.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true } });
    if (!hak || g.confirmation !== hak.lisansNo) {
      throw bad(`${g.level} ikinci onay ister: lisans numarasını aynen yazın`);
    }
  }
  const row = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    return writeAction(tx, { installationDbId: g.installationDbId, type: g.level, param, reason, actor: g.actor });
  });
  await recordAudit({ event: `YAPTIRIM_${g.level}`, entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { eylemId: row.id, sebep: reason } });
  return row;
}

/** Eylemi anında geri al: ters satır. Bir eylem yalnız bir kez geri alınır. */
export async function revertSanction(g: { actionId: string; reason: string; actor: string }): Promise<YaptirimEylemi> {
  const reason = requireReason(g.reason);
  const target = await prisma.yaptirimEylemi.findUnique({ where: { id: g.actionId } });
  if (!target) throw new VendorError(404, "GOVDE_GECERSIZ", "Yaptırım eylemi bulunamadı");
  if (!LEVELS.includes(target.tur)) throw bad("Yalnız K0–K5 eylemleri geri alınır (zorlama/geçerlilik ayrı eylemle değişir)");
  const row = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, target.kurulumId);
    try {
      return await writeAction(tx, {
        installationDbId: target.kurulumId,
        type: "GERI_AL",
        param: { geriAlinanTur: target.tur },
        reason,
        actor: g.actor,
        revertsId: target.id,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new VendorError(409, "GOVDE_GECERSIZ", "Bu eylem zaten geri alındı");
      throw err;
    }
  });
  await recordAudit({ event: "YAPTIRIM_GERI_AL", entity: "Kurulum", entityId: target.kurulumId, actor: g.actor, summary: { eylemId: target.id, sebep: reason } });
  return row;
}

/** Gözlem ↔ zorla. Aynı değere geçiş no-op (satır yazmaz). */
export async function setEnforcement(g: { installationDbId: string; enforce: boolean; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  const reason = requireReason(g.reason);
  const row = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
    if (inst.zorlama === g.enforce) return null;
    const claim = await tx.kurulum.updateMany({ where: { id: inst.id, zorlama: inst.zorlama }, data: { zorlama: g.enforce } });
    if (claim.count === 0) throw retryConflict();
    return writeAction(tx, {
      installationDbId: inst.id,
      type: "ZORLAMA",
      param: { onceki: inst.zorlama, yeni: g.enforce },
      reason,
      actor: g.actor,
    });
  });
  if (row) await recordAudit({ event: "ZORLAMA", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { yeni: g.enforce, sebep: reason } });
  return row;
}

async function setValidityInTx(tx: Tx, g: { installationDbId: string; validUntil: Date | null; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  const hak = await tx.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true } });
  if (!hak) throw new VendorError(404, "GOVDE_GECERSIZ", "Kurulumun aktif hakkı yok");
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

/** Vadeli geçerlilik bitişi: tarih ver (vadeli) ya da null (kalıcıya çevir — HAK `kalici` ayrı, kök parolasıyla). */
export async function setValidityEnd(g: { installationDbId: string; validUntil: Date | null; reason: string; actor: string }): Promise<YaptirimEylemi | null> {
  const reason = requireReason(g.reason);
  const row = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    return setValidityInTx(tx, { ...g, reason });
  });
  if (row) await recordAudit({ event: "GECERLILIK", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { yeni: g.validUntil?.toISOString() ?? null, sebep: reason } });
  return row;
}

/** N gün uzat: bitiş max(şimdi, mevcut bitiş) + N gün. */
export async function extendValidity(g: { installationDbId: string; days: number; reason: string; actor: string; nowMs?: number }): Promise<YaptirimEylemi | null> {
  if (!Number.isInteger(g.days) || g.days < 1 || g.days > 3650) throw bad("Uzatma günü 1–3650 olmalı");
  const hak = await prisma.hak.findFirst({ where: { kurulumId: g.installationDbId, aktif: true } });
  const base = Math.max(g.nowMs ?? Date.now(), hak?.gecerlilikBitis?.getTime() ?? 0);
  return setValidityEnd({ installationDbId: g.installationDbId, validUntil: new Date(base + g.days * DAY_MS), reason: g.reason, actor: g.actor });
}

// -----------------------------------------------------------------------------
// PLANLI EYLEM — vadesinde dakikalık iş uygular (atomik claim: BEKLIYOR → UYGULANDI)
// -----------------------------------------------------------------------------

export async function schedulePlannedAction(g: {
  installationDbId: string;
  level: SanctionLevel;
  dueAt: Date;
  message?: string;
  restrictionDays?: number;
  modules?: readonly string[];
  reason: string;
  actor: string;
}) {
  const reason = requireReason(g.reason);
  if (g.level === "K4" || g.level === "K5") throw bad("K4/K5 planlanamaz: ikinci onayla anında uygulanır");
  // Parametre planlama anında doğrulanır; K3 tarihi vade anına göre yeniden kurulur.
  buildSanctionParam({ level: g.level, message: g.message, restrictionDays: g.restrictionDays, modules: g.modules }, g.dueAt.getTime());
  return prisma.planliEylem.create({
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

export async function cancelPlannedAction(g: { id: string; actor: string }): Promise<void> {
  const claim = await prisma.planliEylem.updateMany({ where: { id: g.id, durum: "BEKLIYOR" }, data: { durum: "IPTAL" } });
  if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "Planlı eylem bekliyor durumunda değil");
  await recordAudit({ event: "PLANLI_EYLEM_IPTAL", entity: "PlanliEylem", entityId: g.id, actor: g.actor });
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
    await writeAction(tx, { installationDbId: p.kurulumId, type: p.tur, param: sanctionParam, reason: p.sebep, actor: `planli:${p.yapan}`, plannedId: p.id });
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

export async function createInstallmentPlan(g: {
  installationDbId: string;
  description: string;
  items: readonly { dueAt: Date; amount: string }[];
  extendDays?: number;
  graceDays?: number;
  restrictionDays?: number;
  actor: string;
}) {
  if (g.items.length === 0) throw bad("Taksit planında en az bir kalem olmalı");
  const items = [...g.items].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
  const extendDays = g.extendDays ?? 15;
  return prisma.$transaction(async (tx) => {
    await lockInstallation(tx, g.installationDbId);
    const plan = await tx.taksitPlani.create({
      data: {
        kurulumId: g.installationDbId,
        aciklama: g.description,
        uzatmaGun: extendDays,
        gecikmeGun: g.graceDays ?? 15,
        kisitlamaGun: g.restrictionDays ?? 15,
        yapan: g.actor,
      },
    });
    for (const [i, item] of items.entries()) {
      await tx.taksitKalemi.create({ data: { planId: plan.id, sira: i + 1, vade: item.dueAt, tutar: item.amount } });
    }
    await setValidityInTx(tx, {
      installationDbId: g.installationDbId,
      validUntil: new Date(items[0]!.dueAt.getTime() + extendDays * DAY_MS),
      reason: `Taksit planı: ${g.description}`,
      actor: g.actor,
    });
    return plan;
  });
}

export async function recordInstallmentPayment(g: { itemId: string; actor: string; nowMs?: number }): Promise<void> {
  const nowMs = g.nowMs ?? Date.now();
  const item = await prisma.taksitKalemi.findUnique({ where: { id: g.itemId }, include: { plan: true } });
  if (!item) throw new VendorError(404, "GOVDE_GECERSIZ", "Taksit kalemi bulunamadı");
  const installationDbId = item.plan.kurulumId;
  await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, installationDbId);
    const claim = await tx.taksitKalemi.updateMany({
      where: { id: item.id, durum: { in: ["BEKLIYOR", "GECIKTI"] } },
      data: { durum: "ODENDI", odemeZamani: new Date(nowMs) },
    });
    if (claim.count === 0) throw new VendorError(409, "GOVDE_GECERSIZ", "Taksit zaten ödenmiş ya da iptal");
    if (item.yaptirimEylemiId) {
      const reverted = await tx.yaptirimEylemi.findUnique({ where: { geriAlinanEylemId: item.yaptirimEylemiId } });
      if (!reverted) {
        await writeAction(tx, {
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
    await setValidityInTx(tx, {
      installationDbId,
      validUntil: next ? new Date(next.vade.getTime() + item.plan.uzatmaGun * DAY_MS) : null,
      reason: next ? `Taksit ${item.sira} ödendi — sonraki vadeye uzatıldı` : "Taksit planı tamamlandı — süre sınırı kalktı",
      actor: g.actor,
    });
  });
  await recordAudit({ event: "TAKSIT_ODENDI", entity: "TaksitKalemi", entityId: item.id, actor: g.actor });
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
        param,
        reason: `Taksit ${item.sira} vadesi + ${item.plan.gecikmeGun} gün geçti`,
        actor: "taksit",
      });
      await tx.taksitKalemi.update({ where: { id: item.id }, data: { yaptirimEylemiId: action.id } });
      return true;
    });
    if (done) applied++;
  }
  return applied;
}
