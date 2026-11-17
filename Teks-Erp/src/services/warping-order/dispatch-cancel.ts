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
import { loadWarpingYarnItems, type WarpingYarnItem } from "../helpers/warping-yarn-open.helper";
import { WARPING_ORDER_TABLE } from "./create";

type Tx = Prisma.TransactionClient;
const kg = (v: Prisma.Decimal) => v.toFixed(3);
const isTransferred = (i: WarpingYarnItem) => i.transferOutKg.gt(0) || i.transferInKg.gt(0);
const TRANSFERRED_MSG = "Bu sevkin ipliği başka siparişe aktarılmış — önce aktarmayı iptal edin (LIFO).";

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
  const blockedReason = d.cancelledAt ? "Sevk zaten iptal edilmiş."
    : returned.length > 0 ? "Bu sevkten iade alınmış — önce iadeleri iptal edin (LIFO)."
    : items.some(isTransferred) ? TRANSFERRED_MSG : null;
  return {
    dispatch: { id: d.id, dispatchNo: d.dispatchNo, cancelledAt: d.cancelledAt?.toISOString() ?? null },
    canCancel: blockedReason === null,
    blockedReason,
    items: items.map((i) => ({ dispatchItemId: i.dispatchItemId, yarnItemId: i.yarnItemId, lotNo: i.lotNo, warehouseId: i.warehouseId, outKg: kg(i.outKg), returnedKg: kg(i.returnedKg) })),
    orderReturnsToOpen: !d.cancelledAt && others === 0,
  };
}

export async function cancelWarpingDispatch(id: string, dispatchId: string, reason: string, userId: string): Promise<{ dispatchId: string; dispatchNo: string; yarnItemsReverted: number; orderStatus: WarpingOrderStatus }> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı.");
  const out = await prisma.$transaction(async (tx) => {
    // Sipariş satırı İLK ifadede kilitlenir: eşzamanlı sevk ile "son canlı sevk → OPEN" geçişi sıraya girer.
    const lock = await tx.warpingOrder.updateMany({ where: { id, status: WarpingOrderStatus.IN_PROGRESS }, data: { updatedById: userId } });
    if (lock.count === 0) {
      const fresh = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
      if (!fresh) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
      throw AppError.conflict(`${fresh.orderNo} durumu ${fresh.status} — sevk iptal edilemez.`, { code: "WARPING_ORDER_NOT_CANCELLABLE", status: fresh.status });
    }
    const d = await loadOwnDispatch(tx, id, dispatchId);
    // D4b-2 LIFO: kalemi başka siparişe aktarılmış (net) sevk düşerse hedefin tuttuğu iplik havada kalır.
    if ((await loadWarpingYarnItems(tx, { dispatchId: d.id })).some(isTransferred)) {
      throw AppError.conflict(TRANSFERRED_MSG, { code: "YARN_ITEM_TRANSFERRED" });
    }
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
  });
  await AuditService.log({ userId, action: "UPDATE", tableName: "SUBCONTRACTOR_DISPATCH", recordId: dispatchId, newData: { cancelled: true, kind: "WARPING", warpingOrderId: id, reason: why, yarnItemsReverted: out.reverted } });
  if (out.status === WarpingOrderStatus.OPEN) {
    await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, oldData: { status: WarpingOrderStatus.IN_PROGRESS }, newData: { status: WarpingOrderStatus.OPEN, reason: "son canlı sevk iptal edildi" } });
  }
  return { dispatchId, dispatchNo: out.dispatchNo, yarnItemsReverted: out.reverted, orderStatus: out.status };
}
