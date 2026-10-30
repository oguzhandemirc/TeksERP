// =============================================================================
// e-İrsaliye ÜRETİMİ — numara + ETTN + XML sürümü (plan §3.2, §3.4, §3.6)
// =============================================================================
// Numara YALNIZ burada doğar: TASLAK→OLUSTURULDU claim'iyle aynı tx'te `nextSeriesNo`
// (max+1; sayaç satırlı `reserveSeriesNo` KULLANILMAZ — tx geri dönünce boşluk bırakırdı).
// Kilit sırası: sevkiyat 8023 → seri 8041 (artan). Doğrulama düşerse tx geri döner,
// hiçbir şey yazılmaz. Lazy-init (ACTIVE kâğıt irsaliyesi yoksa kurulması) tx DIŞINDA.
// ⚠ kalıntı pencere: seri biçimi süreç önbelleğinden okunur; başlangıç değeri commit'i ile
//   önbellek tazelenmesi arasındaki ms'lik aralıkta üretilen numara başlangıcı yok sayar
//   (mükerrer ya da boşluk üretmez, yalnız başlangıç uygulanmaz).
// =============================================================================
import { AuditService } from "../audit.service";
import { randomUUID } from "node:crypto";
import { PrintedDocType, type EIrsaliye, type Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { p2002TargetsCode, withBarcodeRetry } from "../../utils/barcode-retry";
import { lockShipmentScopeTx } from "../helpers/shipment-locks.helper";
import { findCariAccountForCardTx } from "../helpers/finance.helper";
import { printedDocumentService, type PrintedDocSnapshot } from "../printed-document.service";
import { readShippingDocItemNameMode } from "../system-setting.service";
import { resolveAdapter } from "./adapters/registry";
import { buildDespatchAdvice } from "./despatch-advice.builder";
import { mapSnapshotToDespatchInput } from "./despatch-advice.source";
import { validateDespatchInput, validateDespatchXml } from "./despatch-advice.validate";
import { eIrsaliyeAuditEntry, loadRecord, recordView, requireReady, sha256Hex, supplierFromLegalIdentity } from "./e-irsaliye-common.helper";
import { eIrsaliyeCodeLoader, lockEIrsaliyeSeriesTx, nextEIrsaliyeDocumentNo } from "./e-irsaliye-number";
import { resolveEIrsaliyeGate, type EIrsaliyeGate } from "./e-irsaliye-readiness.helper";
import { transitionEIrsaliyeTx } from "./e-irsaliye-transition.helper";

type Tx = Prisma.TransactionClient;

interface BuiltXml {
  xmlId: string;
  version: number;
  sha256: string;
  docId: string;
  docVersion: number;
}

function validationError(hatalar: Array<{ field: string; message: string }>): AppError {
  return AppError.badRequest("e-İrsaliye üretilemedi: eksik ya da hatalı bilgi var.", { code: "EIRSALIYE_VALIDATION", hatalar });
}

/** ACTIVE kâğıt irsaliyesi + alıcı kartı → doğrulanmış XML → yeni (donmuş) sürüm satırı. */
async function writeXmlVersionTx(
  tx: Tx,
  rec: EIrsaliye,
  gate: EIrsaliyeGate,
  ids: { documentNo: string; ettn: string; now: Date; actorId: string | null },
): Promise<BuiltXml> {
  const ship = await tx.shipment.findUnique({
    where: { id: rec.sourceId },
    select: {
      destination: true, dispatchedAt: true, dispatchNote: true, customerId: true,
      customer: { select: { taxNumber: true, address: true, city: true, district: true, country: true } },
    },
  });
  if (!ship?.dispatchedAt) throw AppError.conflict("Sevkiyat sevk edilmiş görünmüyor.", { code: "EIRSALIYE_SHIPMENT_NOT_DISPATCHED" });
  const doc = await tx.printedDocument.findFirst({
    where: { docType: PrintedDocType.SHIPMENT_DISPATCH, sourceId: rec.sourceId },
    orderBy: { version: "desc" },
    select: { id: true, version: true, status: true, snapshot: true },
  });
  if (!doc || doc.status !== "ACTIVE") {
    throw AppError.conflict("Sevkiyatın geçerli bir sevk irsaliyesi yok; önce sevk irsaliyesini açın.", { code: "EIRSALIYE_NO_ACTIVE_DISPATCH_DOC" });
  }
  const cari = await findCariAccountForCardTx(tx, { customerId: ship.customerId, subcontractorId: null }, { taxOffice: true });
  const input = mapSnapshotToDespatchInput({
    snapshot: doc.snapshot as unknown as PrintedDocSnapshot,
    supplier: supplierFromLegalIdentity(gate.legalIdentity),
    record: { ...rec, documentNo: ids.documentNo, ettn: ids.ettn },
    recipient: {
      taxId: ship.customer.taxNumber,
      taxOffice: cari?.taxOffice ?? null,
      address: { streetName: ship.customer.address, citySubdivisionName: ship.customer.district, cityName: ship.customer.city, countryName: ship.customer.country },
    },
    nameMode: await readShippingDocItemNameMode(tx),
    shipmentDestination: ship.destination,
    dispatchNote: ship.dispatchNote,
    now: ids.now,
    dispatchedAt: ship.dispatchedAt,
  });
  const v = validateDespatchInput(input);
  if (!v.ok) throw validationError(v.errors);
  const xml = buildDespatchAdvice(input);
  const xv = validateDespatchXml(xml);
  if (!xv.ok) throw validationError(xv.errors);
  const last = await tx.eIrsaliyeXml.findFirst({ where: { eIrsaliyeId: rec.id }, orderBy: { version: "desc" }, select: { version: true } });
  const sha256 = sha256Hex(xml);
  const row = await tx.eIrsaliyeXml.create({
    data: {
      eIrsaliyeId: rec.id,
      version: (last?.version ?? 0) + 1,
      ettn: ids.ettn,
      xml,
      sha256,
      validation: xv as unknown as Prisma.InputJsonValue,
      createdById: ids.actorId,
    },
    select: { id: true, version: true },
  });
  return { xmlId: row.id, version: row.version, sha256, docId: doc.id, docVersion: doc.version };
}

/** Tx öncesi: hazırlık + lazy-init (dış yol; tx içinde ÇAĞRILMAZ). */
async function prepareOutsideTx(id: string): Promise<{ gate: EIrsaliyeGate; pre: EIrsaliye; adapter: string }> {
  const gate = await resolveEIrsaliyeGate();
  requireReady(gate);
  const pre = await loadRecord(prisma, id);
  await printedDocumentService.getCurrent(PrintedDocType.SHIPMENT_DISPATCH, pre.sourceId);
  return { gate, pre, adapter: resolveAdapter(gate.config.adapter).kod };
}

/** TASLAK → OLUSTURULDU: numara + ETTN + XML v1. Yarışta ikinci deneme 409. */
export async function generate(id: string, userId: string | null) {
  const { gate, pre, adapter } = await prepareOutsideTx(id);
  const out = await withBarcodeRetry(
    () =>
      prisma.$transaction(async (tx) => {
        await lockShipmentScopeTx(tx, pre.sourceId);
        await lockEIrsaliyeSeriesTx(tx);
        const rec = await loadRecord(tx, id);
        const now = new Date();
        const documentNo = await nextEIrsaliyeDocumentNo(now, eIrsaliyeCodeLoader(tx));
        const ettn = randomUUID();
        const built = await writeXmlVersionTx(tx, rec, gate, { documentNo, ettn, now, actorId: userId });
        await transitionEIrsaliyeTx(tx, {
          id, from: ["TASLAK"], to: "OLUSTURULDU", event: "OLUSTURULDU", xmlId: built.xmlId, actorId: userId,
          patch: { documentNo, ettn, currentXmlId: built.xmlId, printedDocumentId: built.docId, printedDocVersion: built.docVersion, adapter },
          conflictMessage: "Bu e-İrsaliye zaten üretilmiş ya da durumu değişmiş; sayfayı yenileyin.",
        });
        return { rec: await loadRecord(tx, id), built };
      }),
    5,
    (e) => p2002TargetsCode(e, "documentNo"),
    "e-İrsaliye numarası",
  );
  await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId, out.rec, { event: "OLUSTURULDU", oncekiDurum: "TASLAK", xmlSha256: out.built.sha256 }));
  return { kayit: recordView(out.rec), xmlVersion: out.built.version };
}

/**
 * Yeniden üret. OLUSTURULDU: aynı no + ETTN, XML v+1. HATA: yeni ETTN, aynı no
 * (⚠ doğrulanacak: GİB'in hatalı belgede aynı numarayı yeni ETTN'le kabul ettiği — plan §3.2).
 * İndirilmiş XML onaysız yeniden üretilmez (portala yüklenmiş olabilir).
 */
export async function regenerate(id: string, body: { onay?: boolean }, userId: string | null) {
  const { gate, pre, adapter } = await prepareOutsideTx(id);
  const out = await prisma.$transaction(async (tx) => {
    await lockShipmentScopeTx(tx, pre.sourceId);
    const rec = await loadRecord(tx, id);
    if (rec.status !== "OLUSTURULDU" && rec.status !== "HATA") {
      throw AppError.conflict("Yalnız oluşturulmuş ya da hata almış e-İrsaliye yeniden üretilir.", { code: "EIRSALIYE_STATE_CONFLICT" });
    }
    if (rec.lastDownloadedAt && body.onay !== true) {
      throw AppError.conflict("Bu XML indirilmiş. Portala yüklediyseniz yeniden üretmeyin; yüklemediyseniz onaylayarak yeniden üretin.", {
        code: "EIRSALIYE_ALREADY_DOWNLOADED",
        lastDownloadedAt: rec.lastDownloadedAt,
      });
    }
    const fromError = rec.status === "HATA";
    const ettn = fromError ? randomUUID() : rec.ettn!;
    const built = await writeXmlVersionTx(tx, rec, gate, { documentNo: rec.documentNo!, ettn, now: new Date(), actorId: userId });
    await transitionEIrsaliyeTx(tx, {
      id, from: [rec.status], to: "OLUSTURULDU", event: "XML_YENIDEN_URETILDI", xmlId: built.xmlId, actorId: userId,
      whereExtra: { currentXmlId: rec.currentXmlId },
      note: fromError ? "Hata sonrası yeni ETTN ile yeniden üretildi" : null,
      patch: {
        ettn, currentXmlId: built.xmlId, printedDocumentId: built.docId, printedDocVersion: built.docVersion, adapter, lastDownloadedAt: null,
        ...(fromError ? { sentXmlId: null, sentAt: null, confirmedNo: null, confirmedEttn: null } : {}),
      },
    });
    return { rec: await loadRecord(tx, id), built, from: rec.status };
  });
  await AuditService.log(eIrsaliyeAuditEntry("UPDATE", userId, out.rec, { event: "XML_YENIDEN_URETILDI", oncekiDurum: out.from, xmlSha256: out.built.sha256 }));
  return { kayit: recordView(out.rec), xmlVersion: out.built.version };
}
