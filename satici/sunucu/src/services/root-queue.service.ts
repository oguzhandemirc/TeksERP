// KÖK İMZASI BEKLEYEN HAK KUYRUĞU (G4 §2.6) — yetenek bildirmeyen (eski) derlemenin HAK değişikliği kök VDS'te
// olmadığı için `hak_kok_talebi`nde bekler: dışa aktarılır (`kuyruk-disa-aktar`) → dönem töreninde Mac'te kökle
// imzalanır (`anahtar.ts kuyruk-imzala`) → içe aktarılır (`donem-ice-aktar`). İçe aktarmada imzalı belgenin yükü
// kuyruktaki yükle BİREBİR aynı olmalıdır ve HAK hâlâ talebin taban sürümünde durmalıdır; değilse talep ESKİDİ olur
// (yeni sürüm yazılmaz). Durum geçişleri atomik claim (`updateMany WHERE {id, durum: BEKLIYOR}`).
import type { HakKokTalebi, HakSurumu, Prisma } from "@prisma/client";
import { TYP, parseJws, verifyEntitlement, type EntitlementDoc } from "../lisans-protokol";
import { recordAudit } from "../lib/audit";
import { VendorError, notFoundError, retryConflict, stateConflict } from "../lib/errors";
import { lockInstallation } from "../lib/locks";
import { prisma, type Db, type Tx } from "../lib/prisma";
import { cursorArgs, page } from "../portal/queries";
import type { VendorContext } from "./context";
import { enqueueNotificationTx } from "../notifications/outbox";
import { buildEntitlementPayload, loadEntitlementTree, writeEntitlementVersionUnderLock, type PreparedEntitlementVersion } from "./entitlement.service";
import { requireReason } from "./sanction.service";

export const ROOT_QUEUE_EXPORT_TYPE = "tekserp-kok-kuyrugu";
export const ROOT_SIGNED_TYPE = "tekserp-kok-imzali-haklar";

export interface RootQueueExport {
  readonly v: 1;
  readonly tur: typeof ROOT_QUEUE_EXPORT_TYPE;
  readonly uretim: string;
  readonly talepler: readonly { readonly talepId: string; readonly hakId: string; readonly lisansNo: string; readonly tabanSurum: number; readonly surum: number; readonly yuk: EntitlementDoc }[];
}

/** Anahtar sırası bağımsız kanonik JSON — kuyruktaki yük ile imzalı belgenin yükü bununla karşılaştırılır. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(walk(value));
}

/** Bekleyen talepler (tören girdisi; ACİL olanlar önce). Yükler açık belgedir (sır taşımaz); dosya yalnız VDS → Mac yolunda durur. */
export async function exportRootQueue(db: Db, nowMs: number = Date.now()): Promise<RootQueueExport> {
  const rows = await db.hakKokTalebi.findMany({ where: { durum: "BEKLIYOR" }, orderBy: [{ acil: "desc" }, { createdAt: "asc" }, { id: "asc" }], include: { hak: { select: { lisansNo: true } } } });
  return {
    v: 1,
    tur: ROOT_QUEUE_EXPORT_TYPE,
    uretim: new Date(nowMs).toISOString(),
    talepler: rows.map((r) => ({ talepId: r.id, hakId: r.hakId, lisansNo: r.hak.lisansNo, tabanSurum: r.tabanSurum, surum: r.surum, yuk: r.yuk as unknown as EntitlementDoc })),
  };
}

/** Genişlik kapısının sistem talebini yazan (denetim ve portal "yapan" sütunu). */
export const CAPABILITY_DOWNGRADE_ACTOR = "sistem:yetenek-dususu";

/**
 * Kurulum kilidi ALTINDA (yetenek düşüşü — genişlik kapısı): güncel şartların KÖK imzası kuyruğa İDEMPOTENT girer — HAK
 * için bekleyen talep varsa yenisi açılmaz (o talep de kök imzalı sürüm doğurur). `urgent`: fabrika kira alamadı; talep
 * ACİL işaretlenir ve talep başına TEK `KOK_IMZASI_ACIL` bildirimi (e-posta + Telegram) aynı tx'te yazılır.
 */
export async function queueCurrentTermsUnderLock(
  tx: Tx,
  g: { readonly entitlementId: string; readonly urgent: boolean; readonly nowMs: number },
): Promise<{ readonly request: HakKokTalebi; readonly created: boolean; readonly escalated: boolean }> {
  let request = await tx.hakKokTalebi.findFirst({ where: { hakId: g.entitlementId, durum: "BEKLIYOR" } });
  let created = false;
  let escalated = false;
  if (!request) {
    const hak = await loadEntitlementTree(tx, g.entitlementId);
    const built = buildEntitlementPayload(hak, {}, g.nowMs, { kind: "KOK" });
    request = await tx.hakKokTalebi.create({
      data: {
        hakId: hak.id,
        kurulumId: hak.kurulumId,
        tabanSurum: hak.guncelSurum,
        surum: hak.guncelSurum + 1,
        yuk: built.payload as unknown as Prisma.InputJsonObject,
        uzunUfuk: built.fields.longHorizon,
        acil: g.urgent,
        sebep: "Yetenek düşüşü: güncel şartların kök imzası (yeteneksiz derleme güncel ara imzalı HAK'ı tanımaz, eski kök sürüm güncelden geniş)",
        yapan: CAPABILITY_DOWNGRADE_ACTOR,
      },
    });
    created = true;
    escalated = g.urgent;
  } else if (g.urgent && !request.acil) {
    const claim = await tx.hakKokTalebi.updateMany({ where: { id: request.id, durum: "BEKLIYOR", acil: false }, data: { acil: true } });
    escalated = claim.count === 1;
    request = await tx.hakKokTalebi.findUniqueOrThrow({ where: { id: request.id } });
  }
  if (escalated) {
    await enqueueNotificationTx(tx, {
      event: "KOK_IMZASI_ACIL",
      keyParts: [request.id],
      installationDbId: request.kurulumId,
      relatedId: request.id,
      portalPath: "/kok-kuyrugu",
      konu: "kök imzası bekleyen HAK — fabrika kira alamıyor",
      tarih: new Date(g.nowMs),
    });
  }
  return { request, created, escalated };
}

export async function findRootRequest(db: Db, id: string): Promise<HakKokTalebi> {
  const row = await db.hakKokTalebi.findUnique({ where: { id } });
  if (!row) throw notFoundError("Kök imzası talebi");
  return row;
}

/** Operatör vazgeçer (BEKLIYOR → IPTAL): kurulum kilidi İLK ifade, geçiş atomik claim. */
export async function cancelRootRequestTx(tx: Tx, g: { request: HakKokTalebi; reason: string; actor: string; nowMs?: number }): Promise<HakKokTalebi> {
  await lockInstallation(tx, g.request.kurulumId);
  const reason = requireReason(g.reason, "Kök talebi iptali");
  const claim = await tx.hakKokTalebi.updateMany({
    where: { id: g.request.id, durum: "BEKLIYOR" },
    data: { durum: "IPTAL", kapanisZamani: new Date(g.nowMs ?? Date.now()), kapatan: g.actor, kapanisSebebi: reason },
  });
  if (claim.count === 0) throw stateConflict("Talep artık beklemede değil (imzalandı, eskidi ya da iptal edildi)");
  return tx.hakKokTalebi.findUniqueOrThrow({ where: { id: g.request.id } });
}

export interface RootSignedImportResult {
  readonly talepId: string;
  readonly durum: "IMZALANDI" | "VARDI" | "ESKIDI" | "IPTAL";
  readonly surum: number | null;
}

/**
 * Kök imzalı HAK'ı içe aktarır: belge gömülü çapaya karşı doğrulanır, imzacı KÖK olmalı, yük talebin yüküyle BİREBİR
 * aynı olmalı (tören başka bir şey imzalayamaz). Kurulum kilidi altında: HAK taban sürümde değilse talep ESKİDİ;
 * öyleyse sürüm deftere yazılır ve talep IMZALANDI olur (ikisi aynı tx'te). Aynı belgenin tekrarı VARDI.
 */
export async function importRootSignedEntitlement(
  ctx: Pick<VendorContext, "keys">,
  g: { talepId: string; belge: string; actor: string; nowMs?: number },
): Promise<RootSignedImportResult> {
  const nowMs = g.nowMs ?? Date.now();
  const request = await findRootRequest(prisma, g.talepId);
  const parsed = parseJws(g.belge);
  if (!parsed.ok || parsed.value.header.typ !== TYP.HAK) throw new VendorError(400, "BELGE_SEMA", "Kök imzalı HAK belgesi biçimsiz");
  const verified = verifyEntitlement(g.belge, ctx.keys.anchor, { nowMs });
  if (!verified.ok) throw new VendorError(400, verified.code, `Kök imzalı HAK doğrulanamadı (${verified.code}): ${verified.message}`);
  if (verified.value.signer.kind !== "KOK") throw new VendorError(400, "BELGE_SEMA", `Kuyruk belgesini yalnız KÖK imzalar (gelen ${verified.value.signer.kind})`);
  if (canonicalJson(verified.value.document) !== canonicalJson(request.yuk)) {
    throw new VendorError(409, "DURUM_CAKISMASI", "İmzalı belgenin yükü kuyruktaki talepten farklı — içe aktarılmadı");
  }
  if (request.durum !== "BEKLIYOR") {
    if (request.durum === "IMZALANDI") {
      const row = request.hakSurumuId ? await prisma.hakSurumu.findUnique({ where: { id: request.hakSurumuId } }) : null;
      if (row?.belge === g.belge) return { talepId: request.id, durum: "VARDI", surum: row.surum };
      throw stateConflict("Talep başka bir belgeyle imzalanmış");
    }
    return { talepId: request.id, durum: request.durum, surum: null };
  }
  const outcome = await prisma.$transaction(async (tx) => {
    await lockInstallation(tx, request.kurulumId);
    return writeRootSignedUnderLock(tx, { request, belge: g.belge, signerKid: verified.value.signer.kid, actor: g.actor, nowMs });
  });
  if (outcome.durum === "IMZALANDI") {
    await recordAudit({ event: "HAK_KOK_IMZASI_YUKLENDI", entity: "Hak", entityId: request.hakId, actor: g.actor, summary: { talepId: request.id, surum: request.surum, imzalayanKid: verified.value.signer.kid } });
  } else {
    await recordAudit({ event: "HAK_KOK_TALEBI_ESKIDI", entity: "Hak", entityId: request.hakId, actor: g.actor, summary: { talepId: request.id, surum: request.surum } });
  }
  return outcome;
}

async function writeRootSignedUnderLock(
  tx: Tx,
  g: { request: HakKokTalebi; belge: string; signerKid: string; actor: string; nowMs: number },
): Promise<RootSignedImportResult> {
  const { request } = g;
  const hak = await tx.hak.findUniqueOrThrow({ where: { id: request.hakId } });
  const closedAt = new Date(g.nowMs);
  if (!hak.aktif || hak.guncelSurum !== request.tabanSurum) {
    const stale = await tx.hakKokTalebi.updateMany({
      where: { id: request.id, durum: "BEKLIYOR" },
      data: { durum: "ESKIDI", kapanisZamani: closedAt, kapatan: g.actor, kapanisSebebi: `HAK taban sürümde değil (${hak.guncelSurum} ≠ ${request.tabanSurum})` },
    });
    if (stale.count === 0) throw retryConflict("Talep bu arada kapandı; yeniden deneyin");
    return { talepId: request.id, durum: "ESKIDI", surum: null };
  }
  const doc = request.yuk as unknown as EntitlementDoc;
  const prepared: PreparedEntitlementVersion = {
    entitlementId: request.hakId,
    installationDbId: request.kurulumId,
    baseVersion: request.tabanSurum,
    version: request.surum,
    token: g.belge,
    signerKid: g.signerKid,
    signerKind: "KOK",
    dealerId: null,
    fields: {
      modules: [...doc.moduller],
      perpetual: doc.kalici,
      maintenanceUntil: new Date(doc.bakimBitis),
      licenseClass: doc.sinif,
      offlineHorizonDays: doc.cevrimdisiUfukGun ?? null,
      modeFloorEnforce: doc.kipAltSiniri === "zorla",
      longHorizon: request.uzunUfuk,
    },
    clearValidity: doc.kalici && !hak.kalici && hak.gecerlilikBitis !== null,
    // Uzun ufuk bildirimi talep anında yazıldı (aynı tekillik anahtarı): burada ikinci kez yazılmaz.
    longHorizonGranted: false,
    issuedAt: new Date(doc.verilis),
    reason: request.sebep,
    actor: request.yapan,
  };
  const version: HakSurumu = await writeEntitlementVersionUnderLock(tx, prepared, { rootRequestId: request.id });
  const claim = await tx.hakKokTalebi.updateMany({
    where: { id: request.id, durum: "BEKLIYOR" },
    data: { durum: "IMZALANDI", kapanisZamani: closedAt, kapatan: g.actor, hakSurumuId: version.id },
  });
  if (claim.count === 0) throw retryConflict("Talep bu arada kapandı; yeniden deneyin");
  return { talepId: request.id, durum: "IMZALANDI", surum: version.surum };
}

/** Portal listesi (süzme sunucuda; sıra `createdAt desc, id desc` — imleç kimlikle). */
export async function listRootRequests(db: Db, g: { status?: HakKokTalebi["durum"]; urgent?: boolean; cursor?: string; limit: number }) {
  const rows = await db.hakKokTalebi.findMany({
    where: { ...(g.status ? { durum: g.status } : {}), ...(g.urgent ? { acil: true } : {}) },
    include: { hak: { select: { lisansNo: true } }, kurulum: { select: { kurulumId: true, ad: true, sinif: true } } },
    ...cursorArgs(g.cursor, g.limit),
  });
  return page(
    rows.map((r) => ({
      id: r.id,
      hakId: r.hakId,
      lisansNo: r.hak.lisansNo,
      kurulum: r.kurulum,
      tabanSurum: r.tabanSurum,
      surum: r.surum,
      uzunUfuk: r.uzunUfuk,
      acil: r.acil,
      durum: r.durum,
      sebep: r.sebep,
      yapan: r.yapan,
      kapanisZamani: r.kapanisZamani,
      kapanisSebebi: r.kapanisSebebi,
      createdAt: r.createdAt,
    })),
    g.limit,
  );
}
