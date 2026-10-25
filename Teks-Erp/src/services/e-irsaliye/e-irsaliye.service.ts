// =============================================================================
// e-İRSALİYE KAYIT MOTORU (E5) — servis yüzü (plan §3.2, §3.7)
// =============================================================================
// Durum tablosu `EIrsaliye` "şu an ne", olay defteri `EIrsaliyeEvent` "ne oldu".
// Her geçiş: tx İLK ifadesi `lockShipmentScopeTx` → `transitionEIrsaliyeTx` (atomik
// claim + olay) → audit tx DIŞINDA. Kayıt silinmez; iptal durum geçişidir.
// Hazırlık kapısı (fail-closed) belge DOĞURAN yollarda: hazırla · üret · yeniden üret ·
// gönder · sorgula. Mevcut kaydı düzelten/iptal eden/indiren yollar yapılandırma
// bozulsa da açık kalır (veri erişimi kesilmez).
// Üretim `e-irsaliye-generate.helper`, gönderim/yanıt `e-irsaliye-exchange.helper`de.
// =============================================================================
import { AuditService } from "../audit.service";
import { EIrsaliyeSourceType, PrintedDocType, type EIrsaliye, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { lockShipmentScopeTx } from "../helpers/shipment-locks.helper";
import { tokenReplay } from "../helpers/token-replay.helper";
import { normalizePlate } from "./despatch-advice.source";
import {
  assertShipmentEligible, eIrsaliyeAuditEntry, DEAD_STATUSES, LOCAL_STATUSES, loadRecord, recordView, requireReady,
} from "./e-irsaliye-common.helper";
import { writeEIrsaliyeEventTx } from "./e-irsaliye-event.helper";
import { resolveEIrsaliyeGate, resolveEIrsaliyeReadiness } from "./e-irsaliye-readiness.helper";
import { transitionEIrsaliyeTx } from "./e-irsaliye-transition.helper";
import { isValidTaxId, isValidTckn } from "./tax-id";

export { generate, regenerate } from "./e-irsaliye-generate.helper";
export { getUndoPreview, markSent, poll, recordResponse, send, undoResponse, undoSent } from "./e-irsaliye-exchange.helper";

type Tx = Prisma.TransactionClient;

/** Kayıtta elle tamamlanan alanlar (plan §2) — hazırla ve düzenle aynı küme. */
export interface EIrsaliyeFields {
  licensePlate?: string | null;
  trailerPlate?: string | null;
  driverFirstName?: string | null;
  driverFamilyName?: string | null;
  driverNationalId?: string | null;
  carrierName?: string | null;
  carrierTaxId?: string | null;
  recipientFirstName?: string | null;
  recipientFamilyName?: string | null;
}

const FIELD_KEYS: ReadonlyArray<keyof EIrsaliyeFields> = [
  "licensePlate", "trailerPlate", "driverFirstName", "driverFamilyName", "driverNationalId",
  "carrierName", "carrierTaxId", "recipientFirstName", "recipientFamilyName",
];

/** Sunucuda doğrula + normalleştir: boş metin null, plaka boşluksuz büyük harf, TCKN/VKN sağlaması. */
function cleanFields(body: EIrsaliyeFields): EIrsaliyeFields {
  const out: EIrsaliyeFields = {};
  for (const k of FIELD_KEYS) {
    if (!(k in body)) continue;
    const v = body[k] == null ? null : String(body[k]).trim() || null;
    out[k] = k === "licensePlate" || k === "trailerPlate" ? normalizePlate(v) : v;
  }
  if (out.driverNationalId && !isValidTckn(out.driverNationalId)) {
    throw AppError.badRequest("Şoför TCKN'si geçersiz (11 hane, sağlama tutmuyor).", { code: "EIRSALIYE_FIELD_INVALID", alan: "driverNationalId" });
  }
  if (out.carrierTaxId && !isValidTaxId(out.carrierTaxId)) {
    throw AppError.badRequest("Taşıyıcı vergi/kimlik numarası geçersiz (VKN 10 ya da TCKN 11 hane, sağlama tutmuyor).", {
      code: "EIRSALIYE_FIELD_INVALID",
      alan: "carrierTaxId",
    });
  }
  return out;
}

export async function getReadiness() {
  return resolveEIrsaliyeReadiness();
}

/** Sevkiyatın canlı + geçmiş kayıtları, olaylar, XML sürüm özetleri (gövdesiz), türetilmiş uyarılar. */
export async function getForShipment(shipmentId: string) {
  const ship = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, destination: true, status: true, dispatchedAt: true } });
  if (!ship) throw AppError.notFound("Sevkiyat bulunamadı.", { code: "SHIPMENT_NOT_FOUND" });
  const records = await prisma.eIrsaliye.findMany({
    where: { sourceType: EIrsaliyeSourceType.SHIPMENT, sourceId: shipmentId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const ids = records.map((r) => r.id);
  const events = await prisma.eIrsaliyeEvent.findMany({ where: { eIrsaliyeId: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const xmls = await prisma.eIrsaliyeXml.findMany({
    where: { eIrsaliyeId: { in: ids } },
    orderBy: { version: "asc" },
    select: { id: true, eIrsaliyeId: true, version: true, ettn: true, sha256: true, createdAt: true },
  });
  const doc = await prisma.printedDocument.findFirst({
    where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: shipmentId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true },
  });
  const view = (r: EIrsaliye) => ({
    ...recordView(r),
    // Kâğıt irsaliye XML'den sonra revize/iptal edildiyse uyarı — kolon değil, türetilir.
    kaynakDegisti: r.printedDocumentId !== null && (!doc || doc.id !== r.printedDocumentId || doc.status !== "ACTIVE"),
    olaylar: events.filter((e) => e.eIrsaliyeId === r.id),
    xmlSurumleri: xmls.filter((x) => x.eIrsaliyeId === r.id),
  });
  const canli = records.find((r) => !DEAD_STATUSES.includes(r.status)) ?? null;
  return {
    shipmentId,
    ihracat: ship.destination === "EXPORT",
    hazirlik: await resolveEIrsaliyeReadiness(),
    aktifIrsaliye: doc ? { version: doc.version, status: doc.status } : null,
    canli: canli ? view(canli) : null,
    gecmis: records.filter((r) => r !== canli).map(view),
  };
}

/** Taşıma önerisi: sevkiyatın plaka/şoför/taşıyıcısı + aynı plakanın son kaydındaki dorse/şoför. */
async function suggestTransportTx(tx: Tx, s: { plateNumber: string | null; driverName: string | null; carrier: string | null }): Promise<EIrsaliyeFields> {
  const plate = normalizePlate(s.plateNumber);
  const prev = plate
    ? await tx.eIrsaliye.findFirst({
        where: { licensePlate: plate },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { trailerPlate: true, driverFirstName: true, driverFamilyName: true, driverNationalId: true },
      })
    : null;
  const parts = (s.driverName ?? "").trim().split(/\s+/).filter(Boolean);
  const first = parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? null;
  const family = parts.length > 1 ? parts[parts.length - 1]! : null;
  const sameDriver = !first || (prev?.driverFirstName === first && prev?.driverFamilyName === family);
  return {
    licensePlate: plate,
    trailerPlate: prev?.trailerPlate ?? null,
    driverFirstName: first ?? prev?.driverFirstName ?? null,
    driverFamilyName: first ? family : prev?.driverFamilyName ?? null,
    driverNationalId: sameDriver ? prev?.driverNationalId ?? null : null,
    carrierName: s.carrier?.trim() || null,
  };
}

function prepareReplay(shipmentId: string) {
  return tokenReplay<EIrsaliye, { created: boolean; kayit: ReturnType<typeof recordView> }>({
    find: (db, clientToken) => db.eIrsaliye.findUnique({ where: { clientToken } }),
    alive: (p) => {
      if (p.status === "IPTAL") {
        throw AppError.conflict("Bu hazırlık iptal edilmiş; e-İrsaliyeyi yeniden hazırlayın.", { code: "EIRSALIYE_CANCELLED" });
      }
    },
    identity: (p) => [{ ad: "shipmentId", mevcut: p.sourceId, gelen: shipmentId }],
    collision: "Bu işlem kimliği başka bir sevkiyatın e-İrsaliyesine ait; formu yeniden açın.",
    respond: (p) => ({ created: true, kayit: recordView(p) }),
  });
}

/** TASLAK doğurur (+ HAZIRLANDI olayı). Sevkiyat başına tek canlı kayıt. */
export async function prepare(shipmentId: string, body: EIrsaliyeFields, clientToken: string | null | undefined, userId: string | null) {
  return prepareReplay(shipmentId).run(clientToken, async () => {
    const gate = await resolveEIrsaliyeGate();
    requireReady(gate);
    const fields = cleanFields(body);
    const rec = await prisma.$transaction(async (tx) => {
      await lockShipmentScopeTx(tx, shipmentId);
      const ship = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { status: true, destination: true, dispatchedAt: true, plateNumber: true, driverName: true, carrier: true },
      });
      assertShipmentEligible(ship, gate.config);
      const where = { sourceType: EIrsaliyeSourceType.SHIPMENT, sourceId: shipmentId };
      const live = await tx.eIrsaliye.findFirst({ where: { ...where, status: { notIn: [...DEAD_STATUSES] } }, select: { documentNo: true } });
      if (live) {
        throw AppError.conflict("Bu sevkiyatın açık bir e-İrsaliye kaydı zaten var.", { code: "EIRSALIYE_ALREADY_EXISTS", documentNo: live.documentNo });
      }
      const rejected = await tx.eIrsaliye.findFirst({ where: { ...where, status: "REDDEDILDI" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
      const created = await tx.eIrsaliye.create({
        data: {
          ...where, shipmentId, status: "TASLAK", adapter: gate.config.adapter,
          ...(await suggestTransportTx(tx, ship)),
          ...fields,
          replacesId: rejected?.id ?? null, clientToken: clientToken ?? null, createdById: userId, updatedById: userId,
        },
      });
      await writeEIrsaliyeEventTx(tx, { eIrsaliyeId: created.id, type: "HAZIRLANDI", fromStatus: null, toStatus: "TASLAK", actorId: userId });
      return created;
    });
    await AuditService.log(eIrsaliyeAuditEntry("CREATE", userId, rec, { event: "HAZIRLANDI" }));
    return { created: true, kayit: recordView(rec) };
  });
}

/** Taşıma/alıcı kişi alanları — yalnız GİB'e gitmemiş kayıtta (TASLAK/OLUSTURULDU/HATA). */
export async function updateFields(id: string, body: EIrsaliyeFields, userId: string | null) {
  const fields = cleanFields(body);
  const pre = await loadRecord(prisma, id);
  const rec = await prisma.$transaction(async (tx) => {
    await lockShipmentScopeTx(tx, pre.sourceId);
    const claim = await tx.eIrsaliye.updateMany({ where: { id, status: { in: [...LOCAL_STATUSES] } }, data: { ...fields, updatedById: userId } });
    if (claim.count === 0) {
      throw AppError.conflict("Gönderilmiş ya da kapanmış e-İrsaliyenin alanları değiştirilemez.", { code: "EIRSALIYE_STATE_CONFLICT" });
    }
    return loadRecord(tx, id);
  });
  await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId, rec, { event: "ALANLAR_DUZENLENDI", alanlar: Object.keys(fields) }));
  return recordView(rec);
}

/** XML indir — yalnız güncel sürümün indirilmesi "indirildi" sayar (yeniden üretim onayına girer). */
export async function download(id: string, version: number | undefined, userId: string | null) {
  const rec = await loadRecord(prisma, id);
  if (!rec.currentXmlId || !rec.documentNo) throw AppError.conflict("Bu kayıt için henüz XML üretilmedi.", { code: "EIRSALIYE_NO_XML" });
  const x = version
    ? await prisma.eIrsaliyeXml.findUnique({ where: { eIrsaliyeId_version: { eIrsaliyeId: id, version } } })
    : await prisma.eIrsaliyeXml.findUnique({ where: { id: rec.currentXmlId } });
  if (!x) throw AppError.notFound("İstenen XML sürümü yok.", { code: "EIRSALIYE_XML_NOT_FOUND" });
  if (x.id === rec.currentXmlId) {
    const fresh = await prisma.$transaction(async (tx) => {
      await lockShipmentScopeTx(tx, rec.sourceId);
      const hit = await tx.eIrsaliye.updateMany({
        where: { id, currentXmlId: x.id },
        data: { lastDownloadedAt: new Date(), downloadCount: { increment: 1 } },
      });
      if (hit.count === 0) throw AppError.conflict("XML bu sırada yeniden üretildi; yeniden indirin.", { code: "EIRSALIYE_STATE_CONFLICT" });
      return loadRecord(tx, id);
    });
    await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId, fresh, { event: "XML_INDIRILDI", xmlSha256: x.sha256 }));
  }
  return { dosyaAdi: `${rec.documentNo}.xml`, version: x.version, ettn: x.ettn, sha256: x.sha256, xml: x.xml, simulasyon: recordView(rec).simulasyon };
}

/** İptal önizlemesi — etkiler somut listelenir. */
export async function getCancelPreview(id: string) {
  const rec = await loadRecord(prisma, id);
  if (!LOCAL_STATUSES.includes(rec.status)) {
    return { kayit: recordView(rec), etkiler: [], engel: "Gönderilmiş ya da kapanmış e-İrsaliye iptal edilemez; alıcı irsaliye yanıtıyla reddeder." };
  }
  const etkiler = ["Kayıt yerel olarak iptal edilir (GİB'e gönderilmedi); geçmişi silinmez."];
  if (rec.documentNo) etkiler.push(`e-İrsaliye no ${rec.documentNo} boşta kalacak; bu numara yeniden kullanılmaz.`);
  etkiler.push("Aynı sevkiyat için yeniden e-İrsaliye hazırlanabilir (yeni numara alır).");
  return { kayit: recordView(rec), etkiler, engel: null };
}

/** TASLAK/OLUSTURULDU/HATA → IPTAL (terminal). */
export async function cancel(id: string, userId: string | null) {
  const pre = await loadRecord(prisma, id);
  const rec = await prisma.$transaction(async (tx) => {
    await lockShipmentScopeTx(tx, pre.sourceId);
    await transitionEIrsaliyeTx(tx, {
      id, from: LOCAL_STATUSES, to: "IPTAL", event: "IPTAL_EDILDI", actorId: userId,
      conflictMessage: "Gönderilmiş ya da kapanmış e-İrsaliye iptal edilemez; sayfayı yenileyin.",
    });
    return loadRecord(tx, id);
  });
  await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId, rec, { event: "IPTAL_EDILDI", oncekiDurum: pre.status }));
  return recordView(rec);
}
