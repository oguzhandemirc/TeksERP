// =============================================================================
// MAL KABUL · SATINALMA OLAYLARI — S3 (geniş katalog 2026-11-14)
// =============================================================================
// Ayrı dosya: ticaret modelleri (`goodsReceipt`, `purchaseOrder`) yalnız ticaret kapılı router zincirine girer
// (`test_ticaret_regime_gate`); depo/sevk olayları `depo.ts`te. Kural aynı: kaydı doğuran tx'in içinden, tek yayma noktası.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
const subject = (type: string, id: string) => ({ type, id, key: id });

// ── Mal kabul · Satınalma ───────────────────────────────────────────────────
/** `malkabul.yapildi` — mal kabul fişi doğuşu (`goods-receipt.service.ts#createFresh`). */
export async function emitGoodsReceiptCreatedTx(tx: Tx, receiptId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const r = await sequentialTx(tx).goodsReceipt.findUnique({
    where: { id: receiptId },
    select: { receiptNo: true, supplier: { select: { name: true } }, subcontractorSupplier: { select: { name: true } } },
  });
  if (!r) return;
  await emitNotification(tx, "malkabul.yapildi", subject("goods_receipt", receiptId), {
    fisId: receiptId, fisNo: r.receiptNo, tedarikci: r.supplier?.name ?? r.subcontractorSupplier?.name ?? "—",
  }, { actorUserId: who(actor) });
}

/** `satinalma.siparis` — alış siparişi doğuşu (`purchase-order.service.ts#createFresh`). */
export async function emitPurchaseOrderCreatedTx(tx: Tx, purchaseOrderId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const p = await sequentialTx(tx).purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: { orderNo: true, supplier: { select: { name: true } }, subcontractorSupplier: { select: { name: true } }, _count: { select: { lines: true } } },
  });
  if (!p) return;
  await emitNotification(tx, "satinalma.siparis", subject("purchase_order", purchaseOrderId), {
    alisId: purchaseOrderId, alisNo: p.orderNo, tedarikci: p.supplier?.name ?? p.subcontractorSupplier?.name ?? "—", kalemSayisi: p._count.lines,
  }, { actorUserId: who(actor) });
}
