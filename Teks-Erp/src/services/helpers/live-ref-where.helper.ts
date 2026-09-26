// =============================================================================
// CANLI REFERANS YÜKLEMLERİ — ana veri arşiv kapılarının ortak "açık/canlı" tanımı
// =============================================================================
// Ürün yaşam döngüsü (`item-lifecycle.helper`) ve diğer ana veri arşiv kapıları
// (`archive-gate/*`) "bu kayıt hâlâ canlı mı" sorusunu AYNI yüklemlerle sorar; ikinci
// kopya yazılmaz (URUN-YASAM-DONGUSU.md §3.1 D1, §6). Yalnız WHERE kurucusu — model
// erişimi YOK (rejim kapısı taramasına dokunuş taşımaz).
// =============================================================================
import {
  OrderStatus,
  Prisma,
  PurchaseOrderStatus,
  RollStatus,
  StepStatus,
  SwatchStatus,
  WarpBeamStatus,
  WeavingOrderStatus,
  WorkOrderStatus,
} from "@prisma/client";
import { K18_DEAD_STATUSES } from "../batch.service";
import { ACTIVE_LINE, MEASURED_LINE, openLineWhere } from "./order-line-scope.helper";

/** Topun canlı OLMADIĞI statüler: K18 ölü kümesi + sevk edilmiş + fire. */
export const DEAD_ROLL_STATUSES: RollStatus[] = [...K18_DEAD_STATUSES, RollStatus.SHIPPED, RollStatus.SCRAP];
export const LIVE_ROLL: Prisma.RollWhereInput = { status: { notIn: DEAD_ROLL_STATUSES } };
/** Canlı kartela: stokta · çuvalda · sevkiyatta (S4). Sevk edilmiş, düşülmüş, iptal canlı değil. */
export const LIVE_SWATCH: Prisma.SwatchWhereInput = {
  status: { in: [SwatchStatus.IN_STOCK, SwatchStatus.IN_SACK, SwatchStatus.IN_SHIPMENT] },
};

export const OPEN_WORK_ORDER: Prisma.WorkOrderWhereInput = {
  status: { in: [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS] },
};
export const OPEN_WEAVING_ORDER: Prisma.WeavingOrderWhereInput = {
  status: { in: [WeavingOrderStatus.PLANNED, WeavingOrderStatus.IN_PROGRESS] },
};
export const OPEN_MACHINE_RUN: Prisma.MachineRunWhereInput = { endedAt: null, revokedAt: null };
export const OPEN_PURCHASE_ORDER: Prisma.PurchaseOrderWhereInput = {
  status: { in: [PurchaseOrderStatus.OPEN, PurchaseOrderStatus.PARTIAL] },
};
export const OPEN_ORDER: Prisma.OrderWhereInput = {
  status: { in: [OrderStatus.PENDING, OrderStatus.APPROVED, OrderStatus.PARTIAL_SHIPPED] },
};
/** Açık iş emrinde henüz yürümemiş/yürüyen adım. */
export const OPEN_STEP: Prisma.WorkOrderStepWhereInput = {
  status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] },
  workOrder: OPEN_WORK_ORDER,
};
/** Levent sahada/elde (iptal, bitmiş, hurda DEĞİL). */
export const LIVE_WARP_BEAM: Prisma.WarpBeamWhereInput = {
  status: { in: [WarpBeamStatus.PLANNED, WarpBeamStatus.READY, WarpBeamStatus.SHIPPED_OUT, WarpBeamStatus.MOUNTED] },
};

/**
 * Açık talep kalemi: iptal edilmemiş ∧ sipariş açık ∧ (metre dışı birim ∨ istenen > sevk edilen).
 * Metre dışı (kg/adet) kalemin sevki ölçülmez → sipariş açık kaldıkça canlıdır.
 */
export function openDemandLineWhere(db: {
  orderLine: { fields: { shippedQty: Prisma.FieldRef<"OrderLine", "Decimal"> } };
}): Prisma.OrderLineWhereInput {
  return {
    ...ACTIVE_LINE,
    order: OPEN_ORDER,
    OR: [{ NOT: MEASURED_LINE }, openLineWhere(db.orderLine.fields)],
  };
}
