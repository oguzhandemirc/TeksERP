// =============================================================================
// FASON DEVERE SİPARİŞİ — iptal (önizlemeli). Soft: durum geçişi OPEN → CANCELLED, hiçbir satır silinmez.
// =============================================================================
// OPEN = sevksiz (ilk sevk claim'i IN_PROGRESS yapar; son canlı sevk iptal edilince OPEN'a döner), bu yüzden
// iptal kapısı tek yüklem: `updateMany WHERE {id, status: OPEN}`. Sevkli sipariş için önce sevk iptali (LIFO).
// =============================================================================
import { WarpingOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { AuditService } from "../audit.service";
import { WARPING_ORDER_TABLE } from "./create";
import { loadWarpingOrderDto, type WarpingOrderDto } from "./read";

export interface WarpingOrderCancelPreview {
  order: Pick<WarpingOrderDto, "id" | "orderNo" | "status" | "targetLengthM" | "beamCount">;
  canCancel: boolean;
  blockedReason: string | null;
  /** Bağı düşmeyecek ama sipariş kapanınca "bağlı devere" listesinden çıkacak müşteri siparişleri. */
  salesOrders: WarpingOrderDto["salesOrders"];
  /** Etkilenen defter satırı — OPEN siparişte yoktur (sevk/levent yok). */
  affected: { dispatches: number; beams: number };
}

function blockedReasonOf(status: WarpingOrderStatus): string | null {
  if (status === WarpingOrderStatus.OPEN) return null;
  if (status === WarpingOrderStatus.IN_PROGRESS) return "Siparişin iplik sevki var — önce sevk(ler)i iptal edin.";
  if (status === WarpingOrderStatus.CANCELLED) return "Sipariş zaten iptal edilmiş.";
  return "Kapanmış sipariş iptal edilemez.";
}

export async function cancelPreviewWarpingOrder(id: string): Promise<WarpingOrderCancelPreview> {
  const o = await loadWarpingOrderDto(prisma, id);
  const blockedReason = blockedReasonOf(o.status);
  return {
    order: { id: o.id, orderNo: o.orderNo, status: o.status, targetLengthM: o.targetLengthM, beamCount: o.beamCount },
    canCancel: blockedReason === null,
    blockedReason,
    salesOrders: o.salesOrders,
    affected: { dispatches: 0, beams: 0 },
  };
}

export async function cancelWarpingOrder(id: string, reason: string, userId: string): Promise<WarpingOrderDto> {
  const why = reason.trim();
  if (why.length < 3) throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı.");
  await prisma.$transaction(async (tx) => {
    const claim = await tx.warpingOrder.updateMany({
      where: { id, status: WarpingOrderStatus.OPEN },
      data: { status: WarpingOrderStatus.CANCELLED, cancelledAt: new Date(), cancelledById: userId, cancelReason: why, updatedById: userId },
    });
    if (claim.count === 0) {
      const fresh = await tx.warpingOrder.findUnique({ where: { id }, select: { orderNo: true, status: true } });
      if (!fresh) throw AppError.notFound("Fason devere siparişi bulunamadı.", { code: "WARPING_ORDER_NOT_FOUND" });
      throw AppError.conflict(`${fresh.orderNo}: ${blockedReasonOf(fresh.status)}`, { code: "WARPING_ORDER_NOT_CANCELLABLE", status: fresh.status });
    }
  });
  const after = await loadWarpingOrderDto(prisma, id);
  await AuditService.log({ userId, action: "UPDATE", tableName: WARPING_ORDER_TABLE, recordId: id, oldData: { status: WarpingOrderStatus.OPEN }, newData: { status: after.status, cancelReason: why } });
  return after;
}
