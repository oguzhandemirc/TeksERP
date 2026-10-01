// HAK SÜRÜMÜ — her yapısal değişiklik (modül tavanı · kalıcı · bakım bitişi · çevrimdışı ufuk · kip alt sınırı) YENİ
// İMZALI SÜRÜMDÜR: alanlar ve sürüm aynı tx'te yazılır. İmzacı yetenek kapısından çıkar (G4 §2.6): `hak-ara` bildiren
// kuruluma VDS'teki ara imzacı (ara parolası formdan); bildirmeyene kök — kök VDS'te yalnız hazırlıkta/A düzeninde durur;
// yoksa değişiklik KÖK KUYRUĞUNA girer (`hak_kok_talebi`) ve dönem töreninde Mac'te imzalanır (`root-queue.service.ts`).
// İmza tx DIŞINDA hazırlanır (parola alt sürecin stdin'ine), sonra kurulum kilidi altında deftere yazılır.
import type { Hak, HakKokTalebi, HakSurumu, Kurulum, Musteri, Prisma, Tesis } from "@prisma/client";
import { EntitlementSchema, TYP, decodeDocument, verifyEntitlement, type EntitlementDoc, type EntitlementSignerKind } from "../lisans-protokol";
import { KeyFileError } from "../keys/key-files";
import { signWithWrappedKey } from "../keys/signer";
import { VendorError, badRequest, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { enqueueNotificationTx } from "../notifications/outbox";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import {
  assertLongHorizonApproval,
  checkModuleFormat,
  installationCapabilities,
  planEntitlementSigner,
  resolveOfflineHorizon,
  type EmbeddedSigner,
  type LongHorizonApproval,
  type SignerPlanKind,
} from "./entitlement-policy";
import { requireReason, setValidityUnderLock } from "./sanction.service";

export interface EntitlementChanges {
  readonly modules?: readonly string[];
  readonly perpetual?: boolean;
  readonly maintenanceUntil?: Date;
  /** Çevrimdışı ufuk: gün (1–3650) ya da `null` = süresiz. Verilmezse mevcut; HAK'ta hiç yoksa varsayılan (400, DEMO/TEST 45). */
  readonly offlineHorizonDays?: number | null;
  /** Kip alt sınırı `zorla`. Verilmezse mevcut. */
  readonly modeFloorEnforce?: boolean;
}

export type EntitlementWithTree = Hak & { kurulum: Kurulum & { tesis: Tesis & { musteri: Musteri } } };

export interface EntitlementFields {
  readonly modules: string[];
  readonly perpetual: boolean;
  readonly maintenanceUntil: Date;
  readonly licenseClass: Kurulum["sinif"];
  /** `null` = süresiz. */
  readonly offlineHorizonDays: number | null;
  readonly modeFloorEnforce: boolean;
  /** 400 günü aşan ya da süresiz ufuk — sürüm defterine `uzunUfuk` işaretiyle yazılır. */
  readonly longHorizon: boolean;
}

export interface PreparedEntitlementVersion {
  readonly entitlementId: string;
  readonly installationDbId: string;
  readonly baseVersion: number;
  readonly version: number;
  readonly token: string;
  readonly signerKid: string;
  readonly signerKind: EntitlementSignerKind;
  readonly dealerId: string | null;
  readonly fields: EntitlementFields;
  /** Kalıcıya çevrildi ve vadeli bitiş vardı → aynı tx'te süre sınırı kalkar (GECERLILIK satırı). */
  readonly clearValidity: boolean;
  /** Uzun ufuk bu sürümle YENİ verildi (ikinci onay alındı) → `UZUN_UFUK_VERILDI`. */
  readonly longHorizonGranted: boolean;
  readonly issuedAt: Date;
  readonly reason: string;
  readonly actor: string;
}

/** Kök kuyruğuna girecek değişiklik: imzalanacak yük AYNEN saklanır (törende bayt bayt bu yük imzalanır). */
export interface PreparedRootRequest {
  readonly entitlementId: string;
  readonly installationDbId: string;
  readonly baseVersion: number;
  readonly version: number;
  readonly payload: EntitlementDoc;
  readonly fields: EntitlementFields;
  readonly longHorizonGranted: boolean;
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
  signer: EmbeddedSigner,
): { payload: EntitlementDoc; fields: EntitlementFields; longHorizonGranted: boolean } {
  const inst = hak.kurulum;
  const modules = changes.modules === undefined ? [...hak.moduller] : checkModuleFormat(changes.modules);
  const perpetual = changes.perpetual ?? hak.kalici;
  const maintenanceUntil = changes.maintenanceUntil ?? hak.bakimBitis;
  if (Number.isNaN(maintenanceUntil.getTime())) throw badRequest("Bakım bitişi geçersiz");
  const horizon = resolveOfflineHorizon(hak, changes.offlineHorizonDays, inst.sinif, signer.kind);
  const modeFloorEnforce = changes.modeFloorEnforce ?? hak.kipAltSiniriZorla;
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
    ...(signer.kind === "BAYI" ? { bayiId: signer.dealerId, bayiSertifikasi: signer.certificate } : {}),
    ...(signer.kind === "ARA" ? { imzaciSertifikasi: signer.certificate } : {}),
    cevrimdisiUfukGun: horizon.days,
    ...(modeFloorEnforce ? { kipAltSiniri: "zorla" as const } : {}),
  };
  const checked = decodeDocument(EntitlementSchema, payload);
  if (!checked.ok) throw badRequest(`HAK şemaya uymuyor: ${checked.message}`);
  return {
    payload: checked.value,
    fields: { modules, perpetual, maintenanceUntil, licenseClass: inst.sinif, offlineHorizonDays: horizon.days, modeFloorEnforce, longHorizon: horizon.long },
    longHorizonGranted: horizon.granted,
  };
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

export interface ChangeInput {
  readonly entitlementId: string;
  readonly changes?: EntitlementChanges;
  readonly reason: string;
  readonly actor: string;
  readonly nowMs?: number;
  /** Kurulumun yetenekleri; verilmezse kayıttan (`installationCapabilities`). */
  readonly capabilities?: readonly string[];
  /** Arayüzün gördüğü plan: uyuşmazsa 409 DURUM_CAKISMASI — parola hiçbir sürece gitmez. */
  readonly expectedSigner?: SignerPlanKind;
  readonly longHorizonApproval?: LongHorizonApproval;
}

/** Ortak ön adım: HAK + plan + bekleyen kuyruk + yük + uzun ufuk onayı (parola KULLANILMADAN). */
async function prepareChange(ctx: VendorContext, g: ChangeInput) {
  const reason = requireReason(g.reason, "HAK sürümü");
  const hak = await loadEntitlementTree(prisma, g.entitlementId);
  if (hak.kurulum.durum === "IPTAL" || !hak.kurulum.aktif) throw stateConflict("İptal edilmiş ya da pasif kurulumun hakkı imzalanamaz");
  const nowMs = g.nowMs ?? Date.now();
  const plan = planEntitlementSigner(ctx.keys, hak.kurulum.sinif, g.capabilities ?? installationCapabilities(hak.kurulum), nowMs);
  if (g.expectedSigner !== undefined && g.expectedSigner !== plan.kind) {
    throw new VendorError(409, "DURUM_CAKISMASI", `İmza planı değişti (${plan.kind}); formu yenileyip yeniden deneyin`, { imzaci: plan.kind });
  }
  const pending = await prisma.hakKokTalebi.findFirst({ where: { hakId: hak.id, durum: "BEKLIYOR" }, select: { id: true } });
  if (pending) throw stateConflict("Bu HAK için kök imzası bekleyen bir talep var; önce o talep iptal edilmeli");
  const signer: EmbeddedSigner = plan.kind === "ARA" ? { kind: "ARA", certificate: plan.certificate } : { kind: "KOK" };
  const built = buildEntitlementPayload(hak, g.changes ?? {}, nowMs, signer);
  if (built.longHorizonGranted) assertLongHorizonApproval(hak, g.longHorizonApproval);
  return { hak, plan, nowMs, reason, ...built };
}

/**
 * İMZALI yeni sürümü HAZIRLAR (tx dışı; plan ARA ya da KOK): alanlar birleşir, yük şemadan geçer, parola imza alt
 * sürecinin stdin'ine gider ve sıfırlanır; imzalanan belge çapaya karşı doğrulanmadan (imzacı türü dahil) dönmez.
 * Plan KUYRUK ise 409 — o yol `prepareRootRequest`tir (parola istemez).
 */
export async function prepareEntitlementVersion(ctx: VendorContext, g: ChangeInput & { password: Buffer }): Promise<PreparedEntitlementVersion> {
  try {
    const c = await prepareChange(ctx, g);
    if (c.plan.kind === "KUYRUK") throw new VendorError(409, "DURUM_CAKISMASI", "Bu HAK değişikliği kök imzası bekler (kuyruk); imza parolası kullanılmadı", { imzaci: "KUYRUK" });
    const token = await signEntitlement(c.plan.keyFile, c.payload, g.password);
    const verified = verifyEntitlement(token, ctx.keys.anchor, { nowMs: c.nowMs });
    if (!verified.ok || verified.value.document.hakId !== c.hak.id || verified.value.document.surum !== c.payload.surum || verified.value.signer.kind !== c.plan.kind) {
      throw new VendorError(500, "SUNUCU_HATASI", "İmzalanan HAK güven çapasına karşı doğrulanamadı");
    }
    return {
      entitlementId: c.hak.id,
      installationDbId: c.hak.kurulumId,
      baseVersion: c.hak.guncelSurum,
      version: c.payload.surum,
      token,
      signerKid: c.plan.kid,
      signerKind: c.plan.kind,
      dealerId: null,
      fields: c.fields,
      clearValidity: g.changes?.perpetual === true && !c.hak.kalici && c.hak.gecerlilikBitis !== null,
      longHorizonGranted: c.longHorizonGranted,
      issuedAt: new Date(c.nowMs),
      reason: c.reason,
      actor: g.actor,
    };
  } finally {
    g.password.fill(0);
  }
}

/** KÖK KUYRUĞU talebini HAZIRLAR (plan KUYRUK; parola YOK). Plan ARA/KOK ise 409 — imza yolu kullanılmalı. */
export async function prepareRootRequest(ctx: VendorContext, g: ChangeInput): Promise<PreparedRootRequest> {
  const c = await prepareChange(ctx, g);
  if (c.plan.kind !== "KUYRUK") throw new VendorError(409, "DURUM_CAKISMASI", `Bu HAK şimdi imzalanabilir (${c.plan.kind}); kök kuyruğuna girmez`, { imzaci: c.plan.kind });
  return {
    entitlementId: c.hak.id,
    installationDbId: c.hak.kurulumId,
    baseVersion: c.hak.guncelSurum,
    version: c.payload.surum,
    payload: c.payload,
    fields: c.fields,
    longHorizonGranted: c.longHorizonGranted,
    reason: c.reason,
    actor: g.actor,
  };
}

/** Uzun ufuk bildirimi (K2): aynı HAK sürümü için TEK satır (kuyruk ve içe aktarma aynı anahtarı paylaşır). */
async function notifyLongHorizonTx(tx: Tx, g: { installationDbId: string; entitlementId: string; version: number; queued: boolean }): Promise<void> {
  await enqueueNotificationTx(tx, {
    event: "UZUN_UFUK_VERILDI",
    keyParts: [g.entitlementId, g.version],
    installationDbId: g.installationDbId,
    relatedId: g.entitlementId,
    portalPath: `/haklar/${g.entitlementId}`,
    konu: g.queued ? "kök imzası bekliyor" : null,
  });
}

/**
 * Kilit ALTINDA: sürüm iddiası (atomik) + alanlar + defter satırı + (kalıcıya çevirde) süre sınırı + zil. Bekleyen kök
 * talebi varken (içe aktarılan talebin kendisi dışında) yeni sürüm YAZILMAZ: kuyruktaki değişiklik sessizce ezilmesin.
 */
export async function writeEntitlementVersionUnderLock(tx: Tx, p: PreparedEntitlementVersion, opts: { readonly rootRequestId?: string } = {}): Promise<HakSurumu> {
  const pending = await tx.hakKokTalebi.findFirst({ where: { hakId: p.entitlementId, durum: "BEKLIYOR", ...(opts.rootRequestId ? { id: { not: opts.rootRequestId } } : {}) }, select: { id: true } });
  if (pending) throw stateConflict("Bu HAK için kök imzası bekleyen bir talep var; önce o talep iptal edilmeli");
  const claim = await tx.hak.updateMany({
    where: { id: p.entitlementId, guncelSurum: p.baseVersion, aktif: true },
    data: {
      guncelSurum: p.version,
      moduller: p.fields.modules,
      kalici: p.fields.perpetual,
      bakimBitis: p.fields.maintenanceUntil,
      cevrimdisiUfukGun: p.fields.offlineHorizonDays,
      cevrimdisiUfukSuresiz: p.fields.offlineHorizonDays === null,
      kipAltSiniriZorla: p.fields.modeFloorEnforce,
    },
  });
  if (claim.count === 0) throw retryConflict("HAK bu arada başka bir sürümle imzalandı; yeniden deneyin");
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: p.installationDbId } });
  if (inst.sinif !== p.fields.licenseClass) throw stateConflict("Kurulum sınıfı imza sırasında değişti; yeniden deneyin");
  const created = await tx.hakSurumu.create({
    data: {
      hakId: p.entitlementId,
      surum: p.version,
      belge: p.token,
      imzalayanKid: p.signerKid,
      verilis: p.issuedAt,
      sebep: p.reason,
      yapan: p.actor,
      uzunUfuk: p.fields.longHorizon,
    },
  });
  if (p.clearValidity) {
    await setValidityUnderLock(tx, { installationDbId: p.installationDbId, validUntil: null, reason: `Kalıcıya çevrildi: ${p.reason}`, actor: p.actor });
  }
  if (p.longHorizonGranted) await notifyLongHorizonTx(tx, { installationDbId: p.installationDbId, entitlementId: p.entitlementId, version: p.version, queued: false });
  await notifyDoorbell(tx, p.installationDbId, "lisans");
  return created;
}

export async function recordEntitlementVersionTx(tx: Tx, p: PreparedEntitlementVersion): Promise<HakSurumu> {
  await lockInstallation(tx, p.installationDbId);
  return writeEntitlementVersionUnderLock(tx, p);
}

/** Kilit ALTINDA: kök kuyruğu talebi (HAK alanları DEĞİŞMEZ — değişiklik imzalı sürümle, törenden sonra iner). */
export async function queueRootRequestUnderLock(tx: Tx, p: PreparedRootRequest): Promise<HakKokTalebi> {
  const hak = await tx.hak.findUnique({ where: { id: p.entitlementId }, include: { kurulum: { select: { sinif: true } } } });
  if (!hak || !hak.aktif || hak.guncelSurum !== p.baseVersion) throw retryConflict("HAK bu arada başka bir sürümle imzalandı; yeniden deneyin");
  if (hak.kurulum.sinif !== p.fields.licenseClass) throw stateConflict("Kurulum sınıfı hazırlık sırasında değişti; yeniden deneyin");
  const pending = await tx.hakKokTalebi.findFirst({ where: { hakId: p.entitlementId, durum: "BEKLIYOR" }, select: { id: true } });
  if (pending) throw stateConflict("Bu HAK için kök imzası bekleyen bir talep var; önce o talep iptal edilmeli");
  const created = await tx.hakKokTalebi.create({
    data: {
      hakId: p.entitlementId,
      kurulumId: p.installationDbId,
      tabanSurum: p.baseVersion,
      surum: p.version,
      yuk: p.payload as unknown as Prisma.InputJsonObject,
      uzunUfuk: p.fields.longHorizon,
      sebep: p.reason,
      yapan: p.actor,
    },
  });
  if (p.longHorizonGranted) await notifyLongHorizonTx(tx, { installationDbId: p.installationDbId, entitlementId: p.entitlementId, version: p.version, queued: true });
  return created;
}

export async function recordRootRequestTx(tx: Tx, p: PreparedRootRequest): Promise<HakKokTalebi> {
  await lockInstallation(tx, p.installationDbId);
  return queueRootRequestUnderLock(tx, p);
}

export function entitlementVersionAudit(row: HakSurumu, p: PreparedEntitlementVersion) {
  return {
    event: p.signerKind === "BAYI" ? "HAK_BAYI_IMZALADI" : p.signerKind === "ARA" ? "HAK_ARA_IMZALADI" : "HAK_IMZALANDI",
    entity: "Hak",
    entityId: row.hakId,
    summary: { surum: row.surum, imzalayanKid: row.imzalayanKid, sebep: p.reason, ...(row.uzunUfuk ? { uzunUfuk: true } : {}) },
  };
}

export function rootRequestAudit(row: HakKokTalebi) {
  return { event: "HAK_KOK_KUYRUGUNA_GIRDI", entity: "Hak", entityId: row.hakId, summary: { talepId: row.id, surum: row.surum, sebep: row.sebep, ...(row.uzunUfuk ? { uzunUfuk: true } : {}) } };
}

