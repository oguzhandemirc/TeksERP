// =============================================================================
// FASON DEVERE — DÖNÜŞ KABUL BELGESİ STORNOSU (devere ek E6): belgenin bütün sipariş parçaları tek tx'te geri alınır
// =============================================================================
// Hep-ya-hiç: herhangi bir parçada LIFO bozan (daha yeni kabul), faturalı, reddedilmiş ya da HAZIR olmayan
// (takılmış/sevkli/tüketilmiş) levent varsa TÜMÜ 409. Parça çekirdeği tek kabul stornosuyla AYNI (`cancelReceiptPartTx`);
// sipariş kısmı stornosu (`/receipts/:key/cancel`) serbest kalır — önceden geri alınmış parça atlanır. Ters kayıt
// bugüne (WOUND_CANCEL), ileri WOUND silinmez; gövde durumu yalnız `applyWarpBeamEventTx` kancasıyla geri yürür.
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { logWarpBeamEventAudit } from "../helpers/warp-beam-event.helper";
import { claimWarpingOrderForWoundCancelTx } from "../helpers/warping-receipt-guard.helper";
import { cancelReceiptPartTx, previewCancelWarpingReceipt, receiptHasLiveBeams, type CancelledReceiptBeam, type WarpingReceiptCancelPreview } from "./receive-cancel";
import { WARPING_RECEIVE_DOC_TABLE } from "./receive-doc";

type Db = Prisma.TransactionClient | typeof prisma;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

interface DocPart { warpingOrderId: string; orderNo: string; receiptKey: string }

/** Belgenin sipariş parçaları (sipariş `id` sırası = kabuldeki claim sırası → deterministik kilit sırası). */
async function loadDocParts(db: Db, id: string) {
  const doc = await db.warpingReceiveDoc.findUnique({
    where: { id },
    select: { id: true, docNo: true, deliveryNoteNo: true, subcontractor: { select: { id: true, code: true, name: true } }, beams: { select: { warpingOrderId: true, warpingReceiptKey: true, warpingOrder: { select: { orderNo: true } } } } },
  });
  if (!doc) throw AppError.notFound("Dönüş kabul belgesi bulunamadı.", { code: "WARPING_RECEIVE_DOC_NOT_FOUND" });
  const parts = new Map<string, DocPart>();
  for (const b of doc.beams) if (b.warpingOrderId && b.warpingReceiptKey) parts.set(b.warpingReceiptKey, { warpingOrderId: b.warpingOrderId, orderNo: b.warpingOrder?.orderNo ?? "", receiptKey: b.warpingReceiptKey });
  const { beams: _beams, ...head } = doc;
  return { head, parts: [...parts.values()].sort((a, b) => a.warpingOrderId.localeCompare(b.warpingOrderId)) };
}

export interface WarpingReceiveDocCancelPreview {
  doc: { id: string; docNo: string; deliveryNoteNo: string | null; subcontractor: { id: string; code: string; name: string } };
  /** Etkilenen her sipariş parçası: geri alınacak leventler + serbest kalacak iplik; önceden geri alınmış parça `alreadyCancelled`. */
  orders: Array<{
    warpingOrderId: string; orderNo: string; receiptKey: string; orderStatus: WarpingOrderStatus; alreadyCancelled: boolean;
    beams: WarpingReceiptCancelPreview["beams"];
    released: Array<WarpingReceiptCancelPreview["released"][number] & { yarnCode: string; yarnName: string; holderOrderNo: string }>;
    blockers: string[];
  }>;
  /** "<sipariş no>: …" önekli; biri bile varsa belge geri alınamaz (hep-ya-hiç). */
  blockers: string[];
  cancellable: boolean;
  totals: { orderCount: number; beamCount: number; lengthM: string };
  reasonRequired: true;
}

/** Önizleme: yazmaz; parça başı tek kabul önizlemesiyle aynı engeller (LIFO, kapalı sipariş, faturalı, ret, HAZIR değil). */
export async function previewCancelWarpingReceiveDoc(id: string): Promise<WarpingReceiveDocCancelPreview> {
  const { head, parts } = await loadDocParts(prisma, id);
  const orders: WarpingReceiveDocCancelPreview["orders"] = [];
  for (const p of parts) {
    const pv = await previewCancelWarpingReceipt(p.warpingOrderId, p.receiptKey);
    const alreadyCancelled = pv.liveBeamCount === 0;
    orders.push({
      warpingOrderId: p.warpingOrderId, orderNo: p.orderNo, receiptKey: p.receiptKey, orderStatus: pv.orderStatus, alreadyCancelled,
      beams: pv.beams, released: pv.released.map((r) => ({ ...r, yarnCode: "", yarnName: "", holderOrderNo: "" })),
      blockers: alreadyCancelled ? [] : pv.blockers,
    });
  }
  const yarnIds = [...new Set(orders.flatMap((o) => o.released.map((r) => r.yarnItemId)))];
  const holderIds = [...new Set(orders.flatMap((o) => o.released.map((r) => r.holderWarpingOrderId)))];
  const yarns = yarnIds.length === 0 ? [] : await prisma.item.findMany({ where: { id: { in: yarnIds } }, select: { id: true, code: true, name: true } });
  const holders = holderIds.length === 0 ? [] : await prisma.warpingOrder.findMany({ where: { id: { in: holderIds } }, select: { id: true, orderNo: true } });
  const yarnBy = new Map(yarns.map((y) => [y.id, y]));
  const holderBy = new Map(holders.map((h) => [h.id, h.orderNo]));
  for (const o of orders) for (const r of o.released) { r.yarnCode = yarnBy.get(r.yarnItemId)?.code ?? ""; r.yarnName = yarnBy.get(r.yarnItemId)?.name ?? ""; r.holderOrderNo = holderBy.get(r.holderWarpingOrderId) ?? ""; }
  const live = orders.filter((o) => !o.alreadyCancelled);
  const blockers = live.flatMap((o) => o.blockers.map((b) => `${o.orderNo}: ${b}`));
  if (live.length === 0) blockers.push("Bu belgenin bütün kabulleri zaten geri alınmış.");
  const liveBeams = live.flatMap((o) => o.beams.filter((b) => b.live));
  return {
    doc: head, orders, blockers, cancellable: blockers.length === 0,
    totals: { orderCount: live.length, beamCount: liveBeams.length, lengthM: liveBeams.reduce((s, b) => s.plus(b.lengthM ?? 0), D(0)).toFixed(3) },
    reasonRequired: true,
  };
}

export interface CancelWarpingReceiveDocResult { id: string; docNo: string; orders: Array<{ warpingOrderId: string; orderNo: string; receiptKey: string; cancelledBeams: Array<{ id: string; beamNo: string }> }> }

/** Belge stornosu: canlı parçaların siparişleri `id` sırasıyla claim (tx'in ilk yazıları) → parça başı ortak çekirdek. */
export async function cancelWarpingReceiveDoc(id: string, reason: string, userId: string): Promise<CancelWarpingReceiveDocResult> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı", { code: "WARPING_RECEIVE_DOC_CANCEL_REASON" });
  const { head, parts } = await loadDocParts(prisma, id);
  // Tümüyle geri alınmış parça atlanır (WOUND_CANCEL terminal — "canlı yok" sonucu yarışta değişmez); kapanmış siparişi claim etmeyiz.
  const liveParts: DocPart[] = [];
  for (const p of parts) if (await receiptHasLiveBeams(prisma, p.warpingOrderId, p.receiptKey)) liveParts.push(p);
  if (liveParts.length === 0) throw AppError.conflict("Bu belgenin bütün kabulleri zaten geri alınmış.", { code: "WARPING_RECEIVE_DOC_NOT_OPEN" });
  const out = await prisma.$transaction(async (tx) => {
    for (const p of liveParts) await claimWarpingOrderForWoundCancelTx(tx, p.warpingOrderId, userId);
    const done: Array<DocPart & { beams: CancelledReceiptBeam[] }> = [];
    for (const p of liveParts) done.push({ ...p, beams: await cancelReceiptPartTx(tx, { warpingOrderId: p.warpingOrderId, receiptKey: p.receiptKey, reason: why, userId, label: p.orderNo }) });
    if (done.every((d) => d.beams.length === 0)) throw AppError.conflict("Bu belgenin bütün kabulleri zaten geri alınmış.", { code: "WARPING_RECEIVE_DOC_NOT_OPEN" });
    return done.filter((d) => d.beams.length > 0);
  });
  for (const d of out) {
    for (const b of d.beams) await logWarpBeamEventAudit({ userId, eventId: b.eventId, kind: "WOUND_CANCEL", data: { beamId: b.id, reversesEventId: b.woundId, warpingOrderId: d.warpingOrderId, receiptKey: d.receiptKey, receiveDocId: id, reason: why } });
  }
  await AuditService.log({
    userId, action: "UPDATE", tableName: WARPING_RECEIVE_DOC_TABLE, recordId: id,
    newData: { docCancelled: head.docNo, reason: why, orders: out.map((d) => ({ warpingOrderId: d.warpingOrderId, receiptKey: d.receiptKey, beams: d.beams.map((b) => b.beamNo) })) },
  });
  return { id, docNo: head.docNo, orders: out.map((d) => ({ warpingOrderId: d.warpingOrderId, orderNo: d.orderNo, receiptKey: d.receiptKey, cancelledBeams: d.beams.map((b) => ({ id: b.id, beamNo: b.beamNo })) })) };
}
