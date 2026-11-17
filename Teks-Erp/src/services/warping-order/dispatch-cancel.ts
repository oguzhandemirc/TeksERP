// =============================================================================
// FASON DEVERE SİPARİŞİ — sevk iptali (önizlemeli, D4b)
// =============================================================================
// LIFO: iade alınmış kalemi olan sevk 409. Sipariş satırı İLK ifadede kilitlenir; son canlı sevk düşünce
// `IN_PROGRESS → OPEN` (plan yeniden düzenlenebilir, sipariş iptal edilebilir).
// =============================================================================
import { Prisma, WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { cancelYarnItemsTx, countReturnedYarnItems } from "../subcontractor-yarn.service";
import { assertWarpingBound } from "../helpers/dispatch-header.helper";
import { loadWarpingYarnItems } from "../helpers/warping-yarn-open.helper";
import { WARPING_ORDER_TABLE } from "./create";

type Tx = Prisma.TransactionClient;
const kg = (v: Prisma.Decimal) => v.toFixed(3);

export interface WarpingDispatchCancelPreview {
  dispatch: { id: string; dispatchNo: string; cancelledAt: string | null };
  canCancel: boolean;
  blockedReason: string | null;
  /** Etkilenen her iplik kalemi — depoya geri dönecek kg (SUBCONTRACT_OUT_CANCEL). */
  items: Array<{ dispatchItemId: string; yarnItemId: string; lotNo: string | null; warehouseId: string; outKg: string; returnedKg: string }>;
  /** Bu sevk düşünce siparişte canlı sevk kalmazsa sipariş OPEN'a döner. */
  orderReturnsToOpen: boolean;
}

async function loadOwnDispatch(db: Pick<Tx, "subcontractorDispatch">, id: string, dispatchId: string) {
  const d = await db.subcontractorDispatch.findUnique({ where: { id: dispatchId }, select: { id: true, dispatchNo: true, warpingOrderId: true, cancelledAt: true } });
  if (!d) throw AppError.notFound("Sevk belgesi bulunamadı.");
  assertWarpingBound(d, "Sevk belgesi");
  if (d.warpingOrderId !== id) throw AppError.notFound("Bu siparişte böyle bir sevk yok.", { code: "WARPING_DISPATCH_NOT_FOUND" });
  return d;
}

export async function previewCancelWarpingDispatch(id: string, dispatchId: string): Promise<WarpingDispatchCancelPreview> {
  const d = await loadOwnDispatch(prisma, id, dispatchId);
  const items = await loadWarpingYarnItems(prisma, { dispatchId });
  const returned = items.filter((i) => i.returnedKg.gt(0));
  const others = await prisma.subcontractorDispatch.count({ where: { warpingOrderId: id, cancelledAt: null, id: { not: dispatchId } } });
  const blockedReason = d.cancelledAt ? "Sevk zaten iptal edilmiş." : returned.length > 0 ? "Bu sevkten iade alınmış — önce iadeleri iptal edin (LIFO)." : null;
  return {
    dispatch: { id: d.id, dispatchNo: d.dispatchNo, cancelledAt: d.cancelledAt?.toISOString() ?? null },
    canCancel: blockedReason === null,
    blockedReason,
    items: items.map((i) => ({ dispatchItemId: i.dispatchItemId, yarnItemId: i.yarnItemId, lotNo: i.lotNo, warehouseId: i.warehouseId, outKg: kg(i.outKg), returnedKg: kg(i.returnedKg) })),
    orderReturnsToOpen: !d.cancelledAt && others === 0,
  };
}

export interface WarpingDispatchCancelTxOut { dispatchNo: string; reverted: number; status: WarpingOrderStatus }

/**
 * Sevk iptalinin tx gövdesi — sipariş satırını kilitleyen claim burada (çağıranın tx'inde ilk ya da fiş claim'inin
 * hemen ardı). Elle iptal ve mal kabul fişi iptali (D4c, doğrudan devere sevki) aynı LIFO kapılarından geçer.
 */
export interface WarpingDispatchCancelArgs { id: string; dispatchId: string; why: string; userId: string }

export async function cancelWarpingDispatchTx(tx: Tx, { id, dispatchId, why, userId }: WarpingDispatchCancelArgs): Promise<WarpingDispatchCancelTxOut> {
  // Sipariş satırı kilitlenir: eşzamanlı sevk ile "son canlı sevk → OPEN" geçişi sıraya girer.
  const lock = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.IN_PROGRESS }, data: { updatedById: userId } });
  if (lock.count === 0) {
    const fresh = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
    if (!fresh) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
    throw AppError.conflict(`${fresh.orderNo} durumu ${fresh.status} — sevk iptal edilemez.`, { code: "WARPING_ORDER_NOT_CANCELLABLE", status: fresh.status });
  }
  const d = await loadOwnDispatch(tx, id, dispatchId);
  if ((await countReturnedYarnItems(tx, d.id)) > 0) {
    throw AppError.conflict("Bu sevkten iade alınmış — sevk iptal edilemez, önce iadeleri iptal edin (LIFO).", { code: "YARN_ITEM_RETURNED" });
  }
  const claim = await tx.subcontractorDispatch.updateMany({ where: { id: d.id, cancelledAt: null }, data: { cancelledAt: new Date(), cancelledById: userId, cancelReason: why } });
  if (claim.count === 0) throw AppError.conflict(`Sevk ${d.dispatchNo} zaten iptal edilmiş.`, { code: "DISPATCH_CANCELLED" });
  const reverted = await cancelYarnItemsTx(tx, { dispatchId: d.id, reason: why, userId });
  const live = await tx.subcontractorDispatch.count({ where: { warpingOrderId: id, cancelledAt: null } });
  let status: WarpingOrderStatus = WarpingOrderStatus.IN_PROGRESS;
  if (live === 0) {
    const back = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.IN_PROGRESS }, data: { status: WarpingOrderStatus.OPEN, updatedById: userId } });
    if (back.count === 1) status = WarpingOrderStatus.OPEN;
  }
  return { dispatchNo: d.dispatchNo, reverted, status };
}

/** Sevk iptali audit'i (tx DIŞINDA). */
export async function auditWarpingDispatchCancel(
  { id, dispatchId, why, userId }: WarpingDispatchCancelArgs, out: WarpingDispatchCancelTxOut, goodsReceiptId?: string,
): Promise<void> {
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchId, newData: { cancelled: true, kind: "WARPING", warpingOrderId: id, reason: why, yarnItemsReverted: out.reverted, goodsReceiptId: goodsReceiptId ?? null } });
  if (out.status === WarpingOrderStatus.OPEN) {
    await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, oldData: { status: WarpingOrderStatus.IN_PROGRESS }, newData: { status: WarpingOrderStatus.OPEN, reason: "son canlı sevk iptal edildi" } });
  }
}

export async function cancelWarpingDispatch(id: string, dispatchId: string, reason: string, userId: string): Promise<{ dispatchId: string; dispatchNo: string; yarnItemsReverted: number; orderStatus: WarpingOrderStatus }> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı.");
  // Sipariş satırı claim'i tx'in İLK ifadesi (`cancelWarpingDispatchTx` başı).
  const out = await prisma.$transaction(async (tx) => cancelWarpingDispatchTx(tx, { id, dispatchId, why, userId }));
  await auditWarpingDispatchCancel({ id, dispatchId, why, userId }, out);
  return { dispatchId, dispatchNo: out.dispatchNo, yarnItemsReverted: out.reverted, orderStatus: out.status };
}
