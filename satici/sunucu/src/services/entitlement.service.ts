// HAK (lisans hakkı) + HAK SÜRÜMÜ (KÖK ya da BAYİ imzalı) + tek kullanımlık etkinleştirme kodu.
// HAK taslağı imzasız doğar (guncelSurum 0); her yapısal değişiklik (modül tavanı · kalıcı · bakım
// bitişi) YENİ İMZALI SÜRÜMDÜR: alanlar ve sürüm aynı tx'te yazılır — imzasız alan değişimi yok.
// İmza tx DIŞINDA hazırlanır (parola alt sürecin stdin'ine), sonra kilit altında deftere yazılır.
// Kod kuruluma bağlı doğar; düz metni yalnız bir kez döner (DB'de sunucu sırlı HMAC + son 4).
import type { Hak, HakSurumu, KodTuru, Kurulum, Musteri, Tesis } from "@prisma/client";
import {
  DAY_MS,
  EntitlementSchema,
  ModuleKeySchema,
  TYP,
  decodeDocument,
  generateActivationCode,
  verifyEntitlement,
  type EntitlementDoc,
} from "../lisans-protokol";
import { KeyFileError } from "../keys/key-files";
import { signWithWrappedKey } from "../keys/signer";
import { recordAudit } from "../lib/audit";
import { VendorError, badRequest, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation, lockLicenseNumber } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import { requireReason, setValidityUnderLock } from "./sanction.service";

export { createCustomer, createInstallation, createSite } from "./master-data.service";

function istanbulYear(nowMs: number): number {
  return Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Istanbul", year: "numeric" }).format(new Date(nowMs)));
}

function checkModuleFormat(modules: readonly string[]): string[] {
  const unique = [...new Set(modules)];
  if (unique.length > 64) throw badRequest("En çok 64 modül");
  for (const m of unique) if (!ModuleKeySchema.safeParse(m).success) throw badRequest(`Modül anahtarı biçimsiz: ${m}`);
  return unique;
}

export interface CreateEntitlementInput {
  readonly installationDbId: string;
  readonly modules: readonly string[];
  readonly perpetual: boolean;
  readonly maintenanceUntil: Date;
  readonly validUntil?: Date | null;
  /** Numaranın yılı bu andan (İstanbul) — kilit ve numara aynı yılı görsün. */
  readonly nowMs: number;
}

/** Hak TASLAĞI doğar (imzasız); lisans numarası (TKS-YYYY-NNNN) doğuşta, yıl sayacı kilidi altında materyalize edilir. */
export async function createEntitlementTx(tx: Tx, g: CreateEntitlementInput): Promise<Hak> {
  await lockLicenseNumber(tx, istanbulYear(g.nowMs));
  const year = istanbulYear(g.nowMs);
  const modules = checkModuleFormat(g.modules);
  if (Number.isNaN(g.maintenanceUntil.getTime())) throw badRequest("Bakım bitişi geçersiz");
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  if (!inst.aktif || inst.durum === "IPTAL") throw stateConflict("Pasif ya da iptal edilmiş kuruluma hak açılamaz");
  const existing = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true }, select: { lisansNo: true } });
  if (existing) throw stateConflict(`Kurulumun zaten aktif bir hakkı var (${existing.lisansNo}); değişiklik yeni sürümle yapılır`);
  const prefix = `TKS-${year}-`;
  const last = await tx.hak.findFirst({ where: { lisansNo: { startsWith: prefix } }, orderBy: { lisansNo: "desc" } });
  const next = last ? Number(last.lisansNo.slice(prefix.length)) + 1 : 1;
  if (next > 999_999) throw new VendorError(500, "SUNUCU_HATASI", "Lisans numarası uzayı doldu");
  return tx.hak.create({
    data: {
      kurulumId: inst.id,
      lisansNo: `${prefix}${String(next).padStart(4, "0")}`,
      moduller: modules,
      kalici: g.perpetual,
      bakimBitis: g.maintenanceUntil,
      gecerlilikBitis: g.validUntil ?? null,
    },
  });
}

export async function createEntitlement(g: Omit<CreateEntitlementInput, "nowMs"> & { nowMs?: number; actor: string }): Promise<Hak> {
  const input: CreateEntitlementInput = { ...g, nowMs: g.nowMs ?? Date.now() };
  const row = await prisma.$transaction((tx) => createEntitlementTx(tx, input));
  await recordAudit({ event: "HAK_EKLENDI", entity: "Hak", entityId: row.id, actor: g.actor, summary: { lisansNo: row.lisansNo } });
  return row;
}

// ---------------------------------------------------------------- HAK sürümü (imza)

export interface EntitlementChanges {
  readonly modules?: readonly string[];
  readonly perpetual?: boolean;
  readonly maintenanceUntil?: Date;
}

export type EntitlementWithTree = Hak & { kurulum: Kurulum & { tesis: Tesis & { musteri: Musteri } } };

export interface PreparedEntitlementVersion {
  readonly entitlementId: string;
  readonly installationDbId: string;
  readonly baseVersion: number;
  readonly version: number;
  readonly token: string;
  readonly signerKid: string;
  readonly signerKind: "KOK" | "BAYI";
  readonly dealerId: string | null;
  readonly fields: { readonly modules: string[]; readonly perpetual: boolean; readonly maintenanceUntil: Date; readonly licenseClass: Kurulum["sinif"] };
  /** Kalıcıya çevrildi ve vadeli bitiş vardı → aynı tx'te süre sınırı kalkar (GECERLILIK satırı). */
  readonly clearValidity: boolean;
  readonly issuedAt: Date;
  readonly reason: string;
  readonly actor: string;
}

export async function loadEntitlementTree(db: Db, entitlementId: string): Promise<EntitlementWithTree> {
  const hak = await db.hak.findUnique({
    where: { id: entitlementId },
    include: { kurulum: { include: { tesis: { include: { musteri: true } } } } },
  });
  if (!hak || !hak.aktif) throw notFoundError("Hak");
  return hak;
}

/** Değişikliklerle birleşmiş alanlar + belge yükü (imzalanmadan önce şemadan geçer). */
export function buildEntitlementPayload(
  hak: EntitlementWithTree,
  changes: EntitlementChanges,
  nowMs: number,
  dealer: { readonly dealerId: string; readonly certificate: string } | null,
): { payload: EntitlementDoc; fields: PreparedEntitlementVersion["fields"] } {
  const inst = hak.kurulum;
  const modules = changes.modules === undefined ? [...hak.moduller] : checkModuleFormat(changes.modules);
  const perpetual = changes.perpetual ?? hak.kalici;
  const maintenanceUntil = changes.maintenanceUntil ?? hak.bakimBitis;
  if (Number.isNaN(maintenanceUntil.getTime())) throw badRequest("Bakım bitişi geçersiz");
  const payload: EntitlementDoc = {
    v: 1,
    hakId: hak.id,
    surum: hak.guncelSurum + 1,
    lisansNo: hak.lisansNo,
    musteri: { id: inst.tesis.musteri.id, ad: inst.tesis.musteri.ad },
    tesis: { id: inst.tesis.id, ad: inst.tesis.ad },
    kurulumId: inst.kurulumId,
    sinif: inst.sinif,
    moduller: modules,
    kalici: perpetual,
    bakimBitis: maintenanceUntil.toISOString(),
    verilis: new Date(nowMs).toISOString(),
    ...(dealer ? { bayiId: dealer.dealerId, bayiSertifikasi: dealer.certificate } : {}),
  };
  const checked = decodeDocument(EntitlementSchema, payload);
  if (!checked.ok) throw badRequest(`HAK şemaya uymuyor: ${checked.message}`);
  return { payload: checked.value, fields: { modules, perpetual, maintenanceUntil, licenseClass: inst.sinif } };
}

/** İmza alt süreci: yanlış parola 400 IMZA_PAROLASI_HATALI (parola hiçbir mesaja girmez). */
export async function signEntitlement(keyFile: string, payload: EntitlementDoc, password: Buffer): Promise<string> {
  try {
    return await signWithWrappedKey({ keyFile, typ: TYP.HAK, payload, password });
  } catch (err) {
    if (err instanceof KeyFileError && err.kind === "YANLIS_PAROLA") throw new VendorError(400, "IMZA_PAROLASI_HATALI", "İmza parolası hatalı");
    throw err;
  }
}

/**
 * KÖK imzalı yeni sürümü HAZIRLAR (tx dışı): alanlar birleşir, yük şemadan geçer, parola imza alt
 * sürecinin stdin'ine gider ve sıfırlanır; imzalanan belge çapaya karşı doğrulanmadan dönmez.
 */
export async function prepareEntitlementVersion(
  ctx: VendorContext,
  g: { entitlementId: string; changes?: EntitlementChanges; password: Buffer; reason: string; actor: string; nowMs?: number },
): Promise<PreparedEntitlementVersion> {
  try {
    const reason = requireReason(g.reason, "HAK sürümü");
    const hak = await loadEntitlementTree(prisma, g.entitlementId);
    if (hak.kurulum.durum === "IPTAL" || !hak.kurulum.aktif) throw stateConflict("İptal edilmiş ya da pasif kurulumun hakkı imzalanamaz");
    const root = ctx.keys.rootFileFor(hak.kurulum.sinif);
    if (!root) throw new VendorError(500, "SUNUCU_HATASI", `${hak.kurulum.sinif} sınıfını imzalayacak (çapadaki) kök anahtar yok`);
    const nowMs = g.nowMs ?? Date.now();
    const changes = g.changes ?? {};
    const { payload, fields } = buildEntitlementPayload(hak, changes, nowMs, null);
    const token = await signEntitlement(root.path, payload, g.password);
    const verified = verifyEntitlement(token, ctx.keys.anchor);
    if (!verified.ok || verified.value.document.hakId !== hak.id || verified.value.document.surum !== payload.surum) {
      throw new VendorError(500, "SUNUCU_HATASI", "İmzalanan HAK güven çapasına karşı doğrulanamadı");
    }
    return {
      entitlementId: hak.id,
      installationDbId: hak.kurulumId,
      baseVersion: hak.guncelSurum,
      version: payload.surum,
      token,
      signerKid: root.kid,
      signerKind: "KOK",
      dealerId: null,
      fields,
      clearValidity: changes.perpetual === true && !hak.kalici && hak.gecerlilikBitis !== null,
      issuedAt: new Date(nowMs),
      reason,
      actor: g.actor,
    };
  } finally {
    g.password.fill(0);
  }
}

/** Kilit ALTINDA: sürüm iddiası (atomik) + alanlar + defter satırı + (kalıcıya çevirde) süre sınırı + zil. */
export async function writeEntitlementVersionUnderLock(tx: Tx, p: PreparedEntitlementVersion): Promise<HakSurumu> {
  const claim = await tx.hak.updateMany({
    where: { id: p.entitlementId, guncelSurum: p.baseVersion, aktif: true },
    data: { guncelSurum: p.version, moduller: p.fields.modules, kalici: p.fields.perpetual, bakimBitis: p.fields.maintenanceUntil },
  });
  if (claim.count === 0) throw retryConflict("HAK bu arada başka bir sürümle imzalandı; yeniden deneyin");
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: p.installationDbId } });
  if (inst.sinif !== p.fields.licenseClass) throw stateConflict("Kurulum sınıfı imza sırasında değişti; yeniden deneyin");
  const created = await tx.hakSurumu.create({
    data: { hakId: p.entitlementId, surum: p.version, belge: p.token, imzalayanKid: p.signerKid, verilis: p.issuedAt, sebep: p.reason, yapan: p.actor },
  });
  if (p.clearValidity) {
    await setValidityUnderLock(tx, { installationDbId: p.installationDbId, validUntil: null, reason: `Kalıcıya çevrildi: ${p.reason}`, actor: p.actor });
  }
  await notifyDoorbell(tx, p.installationDbId, "lisans");
  return created;
}

export async function recordEntitlementVersionTx(tx: Tx, p: PreparedEntitlementVersion): Promise<HakSurumu> {
  await lockInstallation(tx, p.installationDbId);
  return writeEntitlementVersionUnderLock(tx, p);
}

export function entitlementVersionAudit(row: HakSurumu, p: PreparedEntitlementVersion) {
  return {
    event: p.signerKind === "BAYI" ? "HAK_BAYI_IMZALADI" : "HAK_IMZALANDI",
    entity: "Hak",
    entityId: row.hakId,
    summary: { surum: row.surum, imzalayanKid: row.imzalayanKid, sebep: p.reason },
  };
}

/** Düz biçim (CLI · bekçi fikstürü): hazırla → kilit altında yaz → denetim. */
export async function issueEntitlementVersion(
  ctx: VendorContext,
  g: { entitlementId: string; changes?: EntitlementChanges; password: Buffer; reason: string; actor: string; nowMs?: number },
): Promise<HakSurumu> {
  const prepared = await prepareEntitlementVersion(ctx, g);
  const row = await prisma.$transaction((tx) => recordEntitlementVersionTx(tx, prepared));
  await recordAudit({ ...entitlementVersionAudit(row, prepared), actor: g.actor });
  return row;
}

// ---------------------------------------------------------------- etkinleştirme kodu
// Biçim ve üretim protokolde tek kaynak (`generateActivationCode`, 16 karakter). Türü (`ilk` · `tasima`)
// kodun metninde değil burada: `tasima` kodu yalnız onaylanan talepten doğar (transfer.service).

export interface IssuedActivationCode {
  readonly code: string;
  readonly id: string;
  readonly expiresAt: Date;
  readonly codeTail: string;
  readonly kind: KodTuru;
}

export interface IssueActivationCodeInput {
  readonly installationDbId: string;
  readonly validDays?: number;
  readonly actor: string;
  readonly nowMs?: number;
  /** Varsayılan `ilk`; `tasima` yalnız onaylanan taşıma talebiyle (`transferRequestId`). */
  readonly kind?: KodTuru;
  readonly transferRequestId?: string;
}

/**
 * Kilit ALTINDA: kuruluma bağlı tek kullanımlık kod; önceki AKTİF kodlar iptal (tek açık kod).
 * Düz metin YALNIZ dönüşte vardır — DB'de sunucu sırlı HMAC + son 4 karakter (son 4 YALNIZ burada).
 * `ilk` kod: etkinleşmemiş ya da ETKİN kurulum (ETKİN'de yalnız aynı anahtarla yeniden etkinleştirir);
 * `tasima` kodu: yalnız ETKİN kurulum.
 */
export async function issueActivationCodeUnderLock(tx: Tx, ctx: VendorContext, g: IssueActivationCodeInput): Promise<IssuedActivationCode> {
  const nowMs = g.nowMs ?? Date.now();
  const kind: KodTuru = g.kind ?? "ilk";
  if ((kind === "tasima") !== (g.transferRequestId !== undefined)) throw new VendorError(500, "SUNUCU_HATASI", "Taşıma kodu yalnız taşıma talebiyle üretilir");
  const days = g.validDays ?? ctx.config.ETKINLESTIRME_KODU_GUN;
  if (!Number.isInteger(days) || days < 1 || days > 365) throw badRequest("Kod geçerlilik günü 1–365 olmalı");
  const inst = await tx.kurulum.findUnique({ where: { id: g.installationDbId } });
  if (!inst) throw notFoundError("Kurulum");
  const allowed = kind === "tasima" ? inst.durum === "ETKIN" : inst.durum === "ETKINLESMEDI" || inst.durum === "ETKIN";
  if (!inst.aktif || !allowed) throw stateConflict("Bu kurulum için etkinleştirme kodu üretilemez");
  const hak = await tx.hak.findFirst({ where: { kurulumId: inst.id, aktif: true } });
  if (!hak || hak.guncelSurum < 1) throw stateConflict("Önce kurulumun HAK'ı imzalanmalı");
  const code = generateActivationCode();
  await tx.etkinlestirmeKodu.updateMany({ where: { kurulumId: inst.id, durum: "AKTIF" }, data: { durum: "IPTAL" } });
  const created = await tx.etkinlestirmeKodu.create({
    data: {
      kurulumId: inst.id,
      kodOzeti: ctx.codeHasher.digest(code),
      kodSonu: code.slice(-4),
      tur: kind,
      tasimaTalebiId: g.transferRequestId ?? null,
      gecerlilikBitis: new Date(nowMs + days * DAY_MS),
      yapan: g.actor,
    },
  });
  return { code, id: created.id, expiresAt: created.gecerlilikBitis, codeTail: created.kodSonu, kind };
}

export async function createActivationCodeTx(
  tx: Tx,
  ctx: VendorContext,
  g: { installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<IssuedActivationCode> {
  await lockInstallation(tx, g.installationDbId);
  return issueActivationCodeUnderLock(tx, ctx, g);
}

export async function createActivationCode(
  ctx: VendorContext,
  g: { installationDbId: string; validDays?: number; actor: string; nowMs?: number },
): Promise<{ code: string; id: string; expiresAt: Date }> {
  const created = await prisma.$transaction((tx) => createActivationCodeTx(tx, ctx, g));
  await recordAudit({ event: "ETKINLESTIRME_KODU", entity: "Kurulum", entityId: g.installationDbId, actor: g.actor, summary: { kodId: created.id, tur: created.kind } });
  return { code: created.code, id: created.id, expiresAt: created.expiresAt };
}
