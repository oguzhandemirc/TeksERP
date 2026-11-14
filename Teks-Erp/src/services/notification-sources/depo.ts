// =============================================================================
// DEPO · SEVKİYAT · FASON · GELEN BELGE OLAYLARI — S3 (geniş katalog 2026-11-14)
// =============================================================================
// Her OLAY türünün TEK yayma noktası bu dosyadaki fonksiyondur; çağıranlar kaydı doğuran/durumunu geçiren tx'in
// İÇİNDEN, claim'den SONRA çağırır (rollback → bildirim yok; token replay yolu buraya hiç gelmez). Bayrak kapalıyken
// no-op. Mal kabul / satınalma türleri `ticaret.ts`te (ticaret modelleri sevk/fason/transfer router zincirine girmesin
// — rejim kapısı). Sevk metresi sevk anının topları (brüt; iade henüz yok). Yük yalnız kimlik + görüntü dizesi, tutar yok.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { readNotificationParamsTx } from "../helpers/notification-params.helper";
import { formatNotificationNumber } from "../helpers/notification-render.helper";

type Tx = EmitDb & Prisma.TransactionClient;
const m2 = (v: unknown): number => Math.round(Number(String(v ?? 0)) * 100) / 100;
const txt = (s: string | null | undefined, max = 120): string => (s?.trim() ? s.trim().slice(0, max) : "—");
const subject = (type: string, id: string) => ({ type, id, key: id });

// ── Sevkiyat ────────────────────────────────────────────────────────────────
async function shipmentFacts(tx: Tx, shipmentId: string): Promise<{ sevkiyatNo: string; musteriAd: string } | null> {
  const s = await tx.shipment.findUnique({ where: { id: shipmentId }, select: { shipmentNo: true, customer: { select: { name: true } } } });
  return s ? { sevkiyatNo: s.shipmentNo, musteriAd: s.customer?.name ?? "—" } : null;
}

/** `sevkiyat.yola-cikti` — PLANNED→DISPATCHED'in tek çekirdeği `performDispatchTx` (panel · el terminali · doğrudan kurulum). */
export async function emitShipmentDispatchedTx(tx: Tx, shipmentId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await shipmentFacts(tx, shipmentId);
  if (!f) return;
  const agg = await tx.roll.aggregate({ where: { shipmentId }, _count: { _all: true }, _sum: { currentQty: true } });
  await emitNotification(tx, "sevkiyat.yola-cikti", subject("shipment", shipmentId), {
    sevkiyatId: shipmentId, ...f, topSayisi: agg._count._all, metre: m2(agg._sum.currentQty),
  }, { actorUserId: who(actor) });
}

/** Sevkiyatın BRÜT top/metresi: canlı toplar + iptal edilmemiş iade satırları (`reports/_shipped.ts` brüt kuralı). */
async function shipmentGross(tx: Tx, shipmentId: string): Promise<{ topSayisi: number; metre: number }> {
  const live = await tx.roll.aggregate({ where: { shipmentId }, _count: { _all: true }, _sum: { currentQty: true } });
  const back = await tx.rollReturn.aggregate({ where: { fromShipmentId: shipmentId, cancelledAt: null }, _count: { _all: true }, _sum: { qty: true } });
  return { topSayisi: live._count._all + back._count._all, metre: m2(m2(live._sum.currentQty) + m2(back._sum.qty)) };
}

/** `sevkiyat.geri-alindi` — DISPATCHED→PLANNED claim'i (`undo-dispatch.ts`, SoD `shipping:undo-dispatch`). */
export async function emitShipmentUndoneTx(tx: Tx, shipmentId: string, reason: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await shipmentFacts(tx, shipmentId);
  if (!f) return;
  await emitNotification(tx, "sevkiyat.geri-alindi", subject("shipment", shipmentId), { sevkiyatId: shipmentId, ...f, ...(await shipmentGross(tx, shipmentId)), sebep: txt(reason) }, { actorUserId: who(actor) });
}

/** `sevkiyat.faturalandi` — fatura işareti claim'i (`fields.ts`, `shipping:invoice`); işaret kaldırma bildirim değil. */
export async function emitShipmentInvoicedTx(tx: Tx, shipmentId: string, invoiceNo: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await shipmentFacts(tx, shipmentId);
  if (!f) return;
  await emitNotification(tx, "sevkiyat.faturalandi", subject("shipment", shipmentId), { sevkiyatId: shipmentId, ...f, ...(await shipmentGross(tx, shipmentId)), faturaNo: txt(invoiceNo, 64) }, { actorUserId: who(actor) });
}

/** `sevkiyat.iade` — iade belgesi tx'i (`return.service.ts#createReturn`); konu belge lideri, kalemler `returnGroupId`. */
export async function emitReturnReceivedTx(tx: Tx, leaderId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const r = await sequentialTx(tx).rollReturn.findUnique({
    where: { id: leaderId },
    select: { returnNo: true, customer: { select: { name: true } }, fromShipment: { select: { shipmentNo: true } } },
  });
  if (!r) return;
  const agg = await tx.rollReturn.aggregate({ where: { OR: [{ id: leaderId }, { returnGroupId: leaderId }] }, _count: { _all: true }, _sum: { qty: true } });
  await emitNotification(tx, "sevkiyat.iade", subject("roll_return", leaderId), {
    iadeId: leaderId, iadeNo: r.returnNo ?? "—", musteriAd: r.customer?.name ?? "—", sevkiyatNo: r.fromShipment?.shipmentNo ?? "—",
    topSayisi: agg._count._all, metre: m2(agg._sum.qty),
  }, { actorUserId: who(actor) });
}

// ── Depo / Stok ─────────────────────────────────────────────────────────────
/** `stok.elle-duzeltme` — metraj CAS claim'i + sapma defteri (`inventory/qty-adjust.ts`, izin `roll:manual-adjust`). */
export async function emitRollQtyAdjustedTx(tx: Tx, rollId: string, c: { from: unknown; to: unknown; reason: string }, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const r = await tx.roll.findUnique({ where: { id: rollId }, select: { barcode: true } });
  if (!r) return;
  await emitNotification(tx, "stok.elle-duzeltme", subject("roll", rollId), {
    topId: rollId, barkod: r.barcode, eskiMetre: m2(c.from), yeniMetre: m2(c.to), sebep: txt(c.reason),
  }, { actorUserId: who(actor) });
}

/** `stok.sayim-farki` — sayım DRAFT→COMPLETED claim'i (`stock-count.service.ts#complete`); fark yoksa bildirim yok. */
export async function emitStockCountDifferenceTx(
  tx: Tx, countId: string, d: { countNo: string; rolls: number; meters: number; yarn: number }, actor: Actor,
): Promise<void> {
  if (d.rolls + d.yarn === 0) return;
  if (await off(tx)) return;
  await emitNotification(tx, "stok.sayim-farki", subject("stock_count", countId), {
    sayimId: countId, sayimNo: d.countNo, dusulenTop: d.rolls, dusulenMetre: m2(d.meters), iplikDuzeltme: d.yarn,
  }, { actorUserId: who(actor) });
}

/** `stok.transfer` — transfer belgesi doğuşu (`warehouse-transfer.service.ts#createFresh`; replay boğazı dışında). */
export async function emitWarehouseTransferTx(
  tx: Tx, transferId: string, d: { transferNo: string; from: string; to: string; count: number }, actor: Actor,
): Promise<void> {
  if (await off(tx)) return;
  await emitNotification(tx, "stok.transfer", subject("warehouse_transfer", transferId), {
    transferId, transferNo: d.transferNo, kaynakDepo: d.from, hedefDepo: d.to, topSayisi: d.count,
  }, { actorUserId: who(actor) });
}

// ── Fason ───────────────────────────────────────────────────────────────────
/** `fason.cikis` — fason sevk belgesi doğuşu (`subcontractor/dispatch.ts`, belge dondurmasından sonra). */
export async function emitSubcontractDispatchedTx(tx: Tx, dispatchId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const d = await tx.subcontractorDispatch.findUnique({
    where: { id: dispatchId },
    select: { dispatchNo: true, totalQty: true, subcontractor: { select: { name: true } } },
  });
  if (!d) return;
  const rolls = await tx.subcontractorDispatchItem.count({ where: { dispatchId, rollId: { not: null } } });
  const beams = await tx.subcontractorDispatchItem.count({ where: { dispatchId, warpBeamId: { not: null } } });
  const yarn = await tx.subcontractorDispatchItem.aggregate({ where: { dispatchId, yarnItemId: { not: null } }, _sum: { dispatchedQty: true } });
  const parts = [
    rolls > 0 ? `${rolls} top` : null,
    beams > 0 ? `${beams} levent` : null,
    rolls + beams > 0 || m2(d.totalQty) > 0 ? `${formatNotificationNumber(m2(d.totalQty))} m` : null,
    m2(yarn._sum.dispatchedQty) > 0 ? `${formatNotificationNumber(m2(yarn._sum.dispatchedQty))} kg iplik` : null,
  ].filter((p): p is string => p !== null);
  await emitNotification(tx, "fason.cikis", subject("subcontractor_dispatch", dispatchId), {
    sevkId: dispatchId, sevkNo: d.dispatchNo, firmaAd: d.subcontractor?.name ?? "—", icerik: parts.join(", "),
  }, { actorUserId: who(actor) });
}

/**
 * `fason.donus` — fason kabul fişi doğuşu (`subcontractor/receive.ts`; `receiptReplay` boğazı replay'i buraya getirmez) ve
 * fason dokuma kabulü (`subcontractor-weaving.service.ts`, top döngüsünden sonra gerçek doğan top/metre ile). `metre` = dönen.
 */
export async function emitSubcontractReceivedTx(tx: Tx, receiptId: string, c: { rollCount: number; meters: Prisma.Decimal | number }, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const r = await tx.subcontractorReceipt.findUnique({ where: { id: receiptId }, select: { receiptNo: true, subcontractor: { select: { name: true } } } });
  if (!r) return;
  await emitNotification(tx, "fason.donus", subject("subcontractor_receipt", receiptId), {
    kabulId: receiptId, kabulNo: r.receiptNo, firmaAd: r.subcontractor?.name ?? "—", topSayisi: c.rollCount, metre: m2(c.meters),
  }, { actorUserId: who(actor) });
}

/**
 * `fason.fire-farki` — kabulde fasonun hesabından düşülen (giden) ↔ doğan (dönen) metre farkı eşiği (`oran` %, iki yön)
 * aşınca; çağıran çekme/fazla defter satırlarını yazan blok (`subcontractor/receive.ts`), aynı tx. Giden 0 ise oran yok.
 */
export async function emitSubcontractShrinkTx(
  tx: Tx, receiptId: string, c: { consumed: Prisma.Decimal; born: Prisma.Decimal }, actor: Actor,
): Promise<void> {
  if (await off(tx)) return;
  if (!c.consumed.greaterThan(0)) return;
  const diff = c.born.minus(c.consumed);
  const pct = diff.abs().dividedBy(c.consumed).times(100);
  const threshold = Number((await readNotificationParamsTx(tx, "fason.fire-farki")).oran ?? 3);
  if (pct.lessThan(threshold)) return;
  const r = await tx.subcontractorReceipt.findUnique({ where: { id: receiptId }, select: { receiptNo: true, subcontractor: { select: { name: true } } } });
  if (!r) return;
  await emitNotification(tx, "fason.fire-farki", subject("subcontractor_receipt", receiptId), {
    kabulId: receiptId, kabulNo: r.receiptNo, firmaAd: r.subcontractor?.name ?? "—",
    gidenMetre: m2(c.consumed), donenMetre: m2(c.born), farkMetre: m2(diff.abs()),
    yon: diff.isNegative() ? "eksik (çekme)" : "fazla", oranYuzde: Math.round(pct.toNumber() * 10) / 10,
  }, { actorUserId: who(actor) });
}

// ── Gelen belge ─────────────────────────────────────────────────────────────
async function noteFacts(tx: Tx, noteId: string): Promise<{ belgeNo: string; gonderen: string } | null> {
  const n = await sequentialTx(tx).customerDeliveryNote.findUnique({
    where: { id: noteId },
    select: { noteNo: true, senderText: true, senderCustomer: { select: { name: true } }, ownerCustomer: { select: { name: true } } },
  });
  return n ? { belgeNo: n.noteNo, gonderen: n.senderCustomer?.name ?? n.ownerCustomer?.name ?? txt(n.senderText, 80) } : null;
}
const NOTE = (id: string) => subject("customer_delivery_note", id);

/** `gelenbelge.geldi` — belge doğuşu: elle/taslak (`gelen-belge-note.service.ts`) ve OCR (`gelen-belge-okuma.service.ts`). */
export async function emitIncomingDocCreatedTx(tx: Tx, noteId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await noteFacts(tx, noteId);
  if (!f) return;
  await emitNotification(tx, "gelenbelge.geldi", NOTE(noteId), { belgeId: noteId, ...f }, { actorUserId: who(actor) });
}

/** `gelenbelge.onaylandi` — APPROVING→APPROVED kapanış claim'i (`gelen-belge-onay.service.ts`); PARTIAL bildirim değil. */
export async function emitIncomingDocApprovedTx(tx: Tx, noteId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await noteFacts(tx, noteId);
  if (!f) return;
  const agg = await tx.customerDeliveryNoteLine.aggregate({ where: { noteId, rollId: { not: null } }, _count: { _all: true }, _sum: { meters: true } });
  await emitNotification(tx, "gelenbelge.onaylandi", NOTE(noteId), { belgeId: noteId, ...f, topSayisi: agg._count._all, metre: m2(agg._sum.meters) }, { actorUserId: who(actor) });
}

/** `gelenbelge.iptal` — iptal claim'i (`gelen-belge-iptal.service.ts#claimNoteTx`). */
export async function emitIncomingDocCancelledTx(tx: Tx, noteId: string, reason: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await noteFacts(tx, noteId);
  if (!f) return;
  await emitNotification(tx, "gelenbelge.iptal", NOTE(noteId), { belgeId: noteId, ...f, sebep: txt(reason) }, { actorUserId: who(actor) });
}

/**
 * `gelenbelge.mukerrer` (operatör onayıyla geçen aynı belge no / aynı parti no eşi) · `gelenbelge.metre-farki` (toplam
 * farkı gerekçeyle geçildi) — onay claim tx'i (`gelen-belge-onay-claim.service.ts#claimForApproval`).
 */
export async function emitIncomingDocClaimedTx(tx: Tx, noteId: string, c: { varianceReason?: string; peers: readonly string[] }, actor: Actor): Promise<void> {
  if (!c.varianceReason && c.peers.length === 0) return;
  if (await off(tx)) return;
  const f = await noteFacts(tx, noteId);
  if (!f) return;
  const opts = { actorUserId: who(actor) };
  if (c.peers.length > 0) {
    await emitNotification(tx, "gelenbelge.mukerrer", NOTE(noteId), { belgeId: noteId, belgeNo: f.belgeNo, esler: txt([...new Set(c.peers)].join(", ")) }, opts);
  }
  if (c.varianceReason) {
    await emitNotification(tx, "gelenbelge.metre-farki", NOTE(noteId), { belgeId: noteId, ...f, sebep: txt(c.varianceReason) }, opts);
  }
}
