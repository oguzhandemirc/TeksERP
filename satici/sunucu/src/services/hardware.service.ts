// DONANIM DEĞİŞİKLİĞİ BİLDİRİMİ + ZAYIF TANIMA (lisans v2 K8, §3.1-6). Donanım değişikliği lisansı iptal ETMEZ, öğrenilir:
//   · `POST /v1/donanim` (amaç `donanim`, kurulum imzalı; çevrimdışıyken aynı istek zarfla `/v1/cevrimdisi`) — güçlü
//     etkenlerden ≥ 2 tutuyorsa (zayıf kümede zayıf kural) satıcı yeni kümeyi KENDİLİĞİNDEN öğrenir ve yeni kümeyi taşıyan
//     kira döner (talep ONAYLANDI · otomatik); tutmuyorsa portal onay kuyruğuna düşer (BEKLIYOR, kurulum · tür · anahtar
//     başına tek; sonraki bildirim ölçümü tazeler) ve DONANIM_ONAYI_BEKLIYOR bildirimi yazılır.
//   · Zayıf tanıma: etkinleştirmede okunabilen etken < 3 ya da güçlü < 2 → 409 ZAYIF_TANIMA_ONAY_BEKLIYOR (ucuz ön denetim:
//     kod ve nonce TÜKETİLMEZ), talep onay listesine; onay (kurulum + anahtar) sonrası aynı kodla etkinleşir. v2'ye geçen
//     mevcut zayıf kurulum durmaz, zayıf kuralla sürer ve listeye düşer.
//   · Karar (portal): BEKLIYOR → ONAYLANDI | REDDEDILDI atomik claim, sebep zorunlu, kurulum kaydına satır; donanım onayında
//     kabul edilen küme BİLDİRİLEN küme olur (kayıp etken kümeden düşer) ve zil "şimdi yokla" der.
import type { DonanimTalebi, DonanimTalebiTuru, Kurulum, Prisma } from "@prisma/client";
import {
  ENDPOINTS,
  HardwareReportResponseSchema,
  assessIdentification,
  type ActivateRequest,
  type Fingerprint,
  type FingerprintFactor,
  type HardwareReportRequest,
  type HardwareReportResponse,
  type LicenseResponse,
} from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { isUniqueViolation } from "../lib/prisma-errors";
import { enqueueNotificationTx } from "../notifications/outbox";
import { cursorArgs, page } from "../portal/queries";
import type { VendorContext } from "./context";
import { notifyDoorbell } from "./doorbell";
import { canLearnFingerprint, fingerprintComparison } from "./fingerprint-policy";
import { authenticateRequest, installationCancelled } from "./installation-auth";
import { driftAccepted, readFingerprint } from "./lease-chain";
import { capabilityDowngradeRefusal, holdForRootSignatureTx } from "./lease-binding";
import { activeEntitlement, downloadTokens, entitlementForDelivery, issueLease, licenseResponse } from "./lease.service";
import { requireReason } from "./sanction.service";

/** Otomatik öğrenmenin karar vereni (talep satırı ve kurulum kaydı). */
export const AUTO_LEARN_ACTOR = "sistem:guclu-etken";
const AUTO_LEARN_REASON = "Güçlü etkenlerden en az ikisi tuttu: satıcı yeni kümeyi kendiliğinden öğrendi";

const weakPending = (): VendorError =>
  new VendorError(
    409,
    "ZAYIF_TANIMA_ONAY_BEKLIYOR",
    "Bu sunucunun donanımı yeterince tanınamadı (okunabilen etken < 3 ya da güçlü etken < 2); etkinleştirme satıcı onayı bekliyor — onaydan sonra aynı kodla yeniden deneyin",
  );

/**
 * Kilit ALTINDA: bekleyen talebi tazele ya da aç (kurulum · tür · anahtar başına TEK; yarışta UNIQUE → yeniden dene).
 * Yeni talebin bildirimi aynı tx'te (talep başına bir kez).
 */
async function openOrRefreshTx(
  tx: Tx,
  g: { inst: Kurulum; tur: DonanimTalebiTuru; kid: string; reported: Fingerprint; lost: readonly FingerprintFactor[]; reason: string | null; nowMs: number },
): Promise<DonanimTalebi> {
  const at = new Date(g.nowMs);
  const pending = await tx.donanimTalebi.findFirst({ where: { kurulumId: g.inst.id, tur: g.tur, anahtarKimligi: g.kid, durum: "BEKLIYOR" } });
  if (pending) {
    const claim = await tx.donanimTalebi.updateMany({
      where: { id: pending.id, durum: "BEKLIYOR" },
      data: {
        parmakIzi: g.reported,
        kayip: [...g.lost],
        kabulEdilen: (g.inst.kabulEdilenParmakIzi ?? undefined) as Prisma.InputJsonValue | undefined,
        ...(g.reason ? { gerekce: g.reason } : {}),
        bildirimSayisi: { increment: 1 },
        sonBildirim: at,
      },
    });
    if (claim.count === 0) throw retryConflict();
    return tx.donanimTalebi.findUniqueOrThrow({ where: { id: pending.id } });
  }
  try {
    const created = await tx.donanimTalebi.create({
      data: {
        kurulumId: g.inst.id,
        tur: g.tur,
        anahtarKimligi: g.kid,
        parmakIzi: g.reported,
        kabulEdilen: (g.inst.kabulEdilenParmakIzi ?? undefined) as Prisma.InputJsonValue | undefined,
        kayip: [...g.lost],
        gerekce: g.reason,
        sonBildirim: at,
      },
    });
    await enqueueNotificationTx(tx, {
      event: "DONANIM_ONAYI_BEKLIYOR",
      keyParts: [created.id],
      installationDbId: g.inst.id,
      relatedId: created.id,
      portalPath: "/donanim-talepleri",
      referans: g.tur === "ZAYIF_TANIMA" ? "zayıf tanıma (etken < 3 ya da güçlü < 2)" : "donanım değişikliği — güçlü etkenler tutmadı",
      tarih: at,
    });
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw retryConflict();
    throw err;
  }
}

// ---------------------------------------------------------------- donanım bildirimi (/v1/donanim · zarf)

type ReportOutcome = { readonly talep: DonanimTalebi; readonly lisans: LicenseResponse | null } | { readonly unbindable: true };

/**
 * Kilit ALTINDA: güçlüler tutuyorsa öğren + kira (uç ilerler, atomik); tutmuyorsa onay kuyruğu. Öğrenme kirası
 * bağlanamıyorsa (genişlik kapısı; istek elindeki HAK'ı bildirmez — fail-closed) öğrenme de kira da YOK: acil kök
 * talebi commit olur, uç 403 der (kira bağı kapısı, `lease-binding.ts`); güçlüler tutuyorsa sonraki yoklama kümeyi öğrenir.
 */
async function reportInTx(tx: Tx, ctx: VendorContext, g: { installationDbId: string; kid: string; body: HardwareReportRequest; nowMs: number }): Promise<ReportOutcome> {
  await lockInstallation(tx, g.installationDbId);
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: g.installationDbId } });
  if (inst.durum === "IPTAL" || inst.anahtarKimligi !== g.kid) throw installationCancelled();
  if (inst.durum !== "ETKIN") throw new VendorError(403, "KURULUM_IPTAL", "Bu kurulumun donanımı bildirilemez (devredildi ya da etkin değil)");
  const accepted = readFingerprint(inst.kabulEdilenParmakIzi);
  const measured = g.body.parmakIzi;
  // Çatal açıkken hiçbir küme öğrenilmez (kopya kendini "sahip" yapamasın) — talep insan kararına düşer.
  const openFork = await tx.kopyaUyarisi.findFirst({ where: { kurulumId: inst.id, tur: "ZINCIR_CATALI", durum: "ACIK" }, select: { id: true } });
  if (openFork || !canLearnFingerprint(accepted, measured, inst.sinif)) {
    const talep = await openOrRefreshTx(tx, { inst, tur: "DONANIM", kid: g.kid, reported: measured, lost: g.body.kayip, reason: g.body.gerekce, nowMs: g.nowMs });
    return { talep, lisans: null };
  }
  const hak = await activeEntitlement(tx, inst.id);
  const delivered = await entitlementForDelivery(tx, inst, hak);
  if (await holdForRootSignatureTx(tx, { entitlementId: hak.id, delivered, nowMs: g.nowMs })) return { unbindable: true };
  const next = driftAccepted(accepted, measured);
  const at = new Date(g.nowMs);
  const decided = { durum: "ONAYLANDI" as const, otomatik: true, kararZamani: at, kararVeren: AUTO_LEARN_ACTOR, kararSebebi: AUTO_LEARN_REASON };
  const pending = await tx.donanimTalebi.findFirst({ where: { kurulumId: inst.id, tur: "DONANIM", anahtarKimligi: g.kid, durum: "BEKLIYOR" }, select: { id: true } });
  let talep: DonanimTalebi;
  if (pending) {
    const claim = await tx.donanimTalebi.updateMany({
      where: { id: pending.id, durum: "BEKLIYOR" },
      data: { ...decided, parmakIzi: measured, kayip: [...g.body.kayip], bildirimSayisi: { increment: 1 }, sonBildirim: at },
    });
    if (claim.count === 0) throw retryConflict();
    talep = await tx.donanimTalebi.findUniqueOrThrow({ where: { id: pending.id } });
  } else {
    talep = await tx.donanimTalebi.create({
      data: { kurulumId: inst.id, tur: "DONANIM", anahtarKimligi: g.kid, parmakIzi: measured, kabulEdilen: (inst.kabulEdilenParmakIzi ?? undefined) as Prisma.InputJsonValue | undefined, kayip: [...g.body.kayip], gerekce: g.body.gerekce, sonBildirim: at, ...decided },
    });
  }
  await tx.kurulumKaydi.create({
    data: { kurulumId: inst.id, olay: "PARMAK_IZI_OGRENILDI", anahtarKimligi: g.kid, ayrinti: { talepId: talep.id, otomatik: true, eski: accepted, yeni: next }, yapan: AUTO_LEARN_ACTOR },
  });
  const lease = await issueLease(tx, ctx, {
    installation: inst,
    entitlement: hak,
    previousLeaseId: inst.sonKiraId,
    decision: "NORMAL",
    clientFingerprint: measured,
    acceptedFingerprint: next,
    nowMs: g.nowMs,
  });
  const claim = await tx.kurulum.updateMany({ where: { id: inst.id, sonKiraId: inst.sonKiraId, anahtarKimligi: g.kid }, data: { sonKiraId: lease.id, kabulEdilenParmakIzi: next } });
  if (claim.count === 0) throw retryConflict();
  return {
    talep,
    lisans: licenseResponse({
      hak: lease.entitlement.withheld ? null : lease.entitlement.belge,
      kira: lease.token,
      tokens: downloadTokens(ctx, inst, hak, lease.sanction, g.nowMs),
      nowMs: g.nowMs,
      revocation: lease.revocation,
    }),
  };
}

/** Uç (gövde KATI şemadan geçmiş): imza (kayıtlı anahtar, amaç `donanim`) → hız sınırı → nonce → kilitli tx. */
export async function handleHardwareReport(
  ctx: VendorContext,
  g: { header: unknown; rawBody: Buffer; body: HardwareReportRequest; nowMs: number; limit?: (scope: string) => void; path?: string },
): Promise<HardwareReportResponse> {
  const auth = await authenticateRequest({ header: g.header, rawBody: g.rawBody, purposes: ["donanim"], nowMs: g.nowMs, limit: g.limit, path: g.path ?? ENDPOINTS.HARDWARE });
  const r = await prisma.$transaction((tx) => reportInTx(tx, ctx, { installationDbId: auth.installation.id, kid: auth.kid, body: g.body, nowMs: g.nowMs }));
  if ("unbindable" in r) throw capabilityDowngradeRefusal();
  await recordAudit({
    event: r.lisans ? "PARMAK_IZI_OGRENILDI" : "DONANIM_BILDIRIMI",
    entity: "DonanimTalebi",
    entityId: r.talep.id,
    actor: "kurulum",
    summary: { kurulumId: auth.installation.id, durum: r.talep.durum, kayip: r.talep.kayip, bildirimSayisi: r.talep.bildirimSayisi },
  });
  return HardwareReportResponseSchema.parse({ v: 1, talepId: r.talep.id, durum: r.talep.durum, lisans: r.lisans });
}

// ---------------------------------------------------------------- zayıf tanıma

/** Bu anahtarın bu kurulumda zayıf tanıma onayı var mı (onay anahtara bağlıdır — taşınan makine yeniden onay ister). */
async function weakApproved(db: Db, installationDbId: string, kid: string): Promise<boolean> {
  return (await db.donanimTalebi.count({ where: { kurulumId: installationDbId, tur: "ZAYIF_TANIMA", anahtarKimligi: kid, durum: "ONAYLANDI" } })) > 0;
}

/**
 * Etkinleştirmenin ucuz ön denetimi (kodu tüketecek istekte, nonce'tan ÖNCE): okunabilen etken < 3 ya da güçlü < 2 ve bu
 * anahtar için onay yoksa talep listeye düşer (kendi kilitli tx'i, commit olur) ve 409 — kod ve nonce tüketilmez.
 */
export async function assertIdentificationOnActivation(inst: Kurulum, kid: string, body: ActivateRequest, nowMs: number): Promise<void> {
  if (!assessIdentification(body.parmakIzi, { excludeF5: inst.sinif === "DR" }).weak) return;
  if (await weakApproved(prisma, inst.id, kid)) return;
  const talep = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, inst.id);
    if (await weakApproved(tx, inst.id, kid)) return null;
    return openOrRefreshTx(tx, { inst, tur: "ZAYIF_TANIMA", kid, reported: body.parmakIzi, lost: body.parmakIziKayip ?? [], reason: null, nowMs });
  });
  if (!talep) return;
  await recordAudit({ event: "ZAYIF_TANIMA_TALEBI", entity: "DonanimTalebi", entityId: talep.id, actor: "kurulum", summary: { kurulumId: inst.id, bildirimSayisi: talep.bildirimSayisi } });
  throw weakPending();
}

/**
 * Kurulum kilidi ALTINDA (zincir sahibinin yoklaması, `parmak-izi-v2` bildiren): v1'den gelen zayıf kurulum DURMAZ —
 * zayıf kuralla sürer — ve bu anahtar için onay ya da bekleyen talep yoksa onay listesine düşer (idempotent).
 */
export async function listLegacyWeakInstallationTx(tx: Tx, g: { inst: Kurulum; kid: string; nowMs: number }): Promise<void> {
  const accepted = readFingerprint(g.inst.kabulEdilenParmakIzi);
  if (!assessIdentification(accepted, { excludeF5: g.inst.sinif === "DR" }).weak) return;
  const known = await tx.donanimTalebi.count({ where: { kurulumId: g.inst.id, tur: "ZAYIF_TANIMA", anahtarKimligi: g.kid, durum: { in: ["BEKLIYOR", "ONAYLANDI"] } } });
  if (known > 0) return;
  await openOrRefreshTx(tx, { inst: g.inst, tur: "ZAYIF_TANIMA", kid: g.kid, reported: accepted, lost: [], reason: null, nowMs: g.nowMs });
}

// ---------------------------------------------------------------- portal: liste + karar

export async function findHardwareRequest(db: Db, id: string): Promise<DonanimTalebi> {
  const row = await db.donanimTalebi.findUnique({ where: { id } });
  if (!row) throw notFoundError("Donanım talebi");
  return row;
}

/**
 * Karar (BEKLIYOR → ONAYLANDI | REDDEDILDI): kurulum kilidi İLK ifade, geçiş atomik claim, sebep zorunlu, kurulum kaydına
 * satır. Donanım onayında kabul edilen küme bildirilen küme olur — yalnız talebin anahtarı hâlâ kurulumun anahtarıysa.
 */
export async function decideHardwareTx(
  tx: Tx,
  g: { talep: DonanimTalebi; decision: "ONAYLANDI" | "REDDEDILDI"; actor: string; reason: string; nowMs?: number },
): Promise<DonanimTalebi> {
  await lockInstallation(tx, g.talep.kurulumId);
  const reason = requireReason(g.reason, "Donanım talebi kararı");
  const at = new Date(g.nowMs ?? Date.now());
  const claim = await tx.donanimTalebi.updateMany({
    where: { id: g.talep.id, durum: "BEKLIYOR" },
    data: { durum: g.decision, kararZamani: at, kararVeren: g.actor, kararSebebi: reason },
  });
  if (claim.count === 0) throw stateConflict("Donanım talebi zaten karara bağlanmış");
  const talep = await tx.donanimTalebi.findUniqueOrThrow({ where: { id: g.talep.id } });
  const inst = await tx.kurulum.findUniqueOrThrow({ where: { id: talep.kurulumId } });
  const ayrinti: Prisma.InputJsonObject = { talepId: talep.id, tur: talep.tur, sebep: reason };
  if (g.decision === "ONAYLANDI" && talep.tur === "DONANIM") {
    if (inst.durum !== "ETKIN" || inst.anahtarKimligi !== talep.anahtarKimligi) throw stateConflict("Talebin anahtarı kurulumun güncel anahtarı değil (taşındı ya da etkin değil); onaylanamaz");
    const set = await tx.kurulum.updateMany({ where: { id: inst.id, anahtarKimligi: talep.anahtarKimligi }, data: { kabulEdilenParmakIzi: talep.parmakIzi as Prisma.InputJsonObject } });
    if (set.count === 0) throw retryConflict();
    Object.assign(ayrinti, { eski: (inst.kabulEdilenParmakIzi ?? null) as Prisma.InputJsonValue | null, yeni: talep.parmakIzi as Prisma.InputJsonValue });
    await notifyDoorbell(tx, inst.id, "lisans");
  }
  const olay = g.decision === "REDDEDILDI" ? "PARMAK_IZI_REDDEDILDI" : talep.tur === "DONANIM" ? "PARMAK_IZI_ONAYLANDI" : "ZAYIF_TANIMA_ONAYLANDI";
  await tx.kurulumKaydi.create({ data: { kurulumId: inst.id, olay, anahtarKimligi: talep.anahtarKimligi, ayrinti, yapan: g.actor } });
  return talep;
}

/** Portal listesi (süzme sunucuda): tuzlu özetler YERİNE etken etken karşılaştırma döner. */
export async function listHardwareRequests(db: Db, g: { status?: DonanimTalebi["durum"]; kind?: DonanimTalebiTuru; cursor?: string; limit: number }) {
  const rows = await db.donanimTalebi.findMany({
    where: { ...(g.status ? { durum: g.status } : {}), ...(g.kind ? { tur: g.kind } : {}) },
    include: { kurulum: { select: { kurulumId: true, ad: true, sinif: true, kabulEdilenParmakIzi: true, tesis: { select: { ad: true, musteri: { select: { ad: true } } } } } } },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(rows.map(hardwareRequestView), g.limit);
}

type RowWithInstallation = DonanimTalebi & {
  kurulum: { kurulumId: string; ad: string | null; sinif: Kurulum["sinif"]; kabulEdilenParmakIzi: unknown; tesis: { ad: string; musteri: { ad: string } } };
};

function hardwareRequestView(r: RowWithInstallation) {
  // Bekleyen talep GÜNCEL kabul kümesine göre, kararlı talep karar anındakine (talep satırındaki) göre karşılaştırılır.
  const base = readFingerprint(r.durum === "BEKLIYOR" ? r.kurulum.kabulEdilenParmakIzi : r.kabulEdilen);
  const { kabulEdilenParmakIzi: _accepted, ...kurulum } = r.kurulum;
  return {
    id: r.id,
    kurulumId: r.kurulumId,
    kurulum,
    tur: r.tur,
    durum: r.durum,
    anahtarKimligi: r.anahtarKimligi,
    kayip: r.kayip,
    gerekce: r.gerekce,
    otomatik: r.otomatik,
    bildirimSayisi: r.bildirimSayisi,
    sonBildirim: r.sonBildirim,
    kararZamani: r.kararZamani,
    kararVeren: r.kararVeren,
    kararSebebi: r.kararSebebi,
    createdAt: r.createdAt,
    karsilastirma: fingerprintComparison(base, readFingerprint(r.parmakIzi), r.kurulum.sinif),
  };
}
