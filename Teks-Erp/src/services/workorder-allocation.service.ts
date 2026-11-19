// =============================================================================
// İş emri metresini AÇIK sipariş bağlarına sonradan paylaştırma (2026-11-19).
// Kurallar `helpers/order-link-allocation.helper`; `allocatedQty`nin bu yoldaki TEK
// yazarı burası — audit'i aynı dosya basar (tx dışında).
// =============================================================================

import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import type { ApiResponse } from "../types/api.types";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { ACTIVE_ORDER_LINK } from "./helpers/order-link.helper";
import type { WorkOrderEventCtx } from "./helpers/workorder-event.helper";
import {
  ORDER_ALLOCATION_TRIGGER,
  assertAllocationWithinBasisTx,
  loadAllocatableLinksTx,
  orderLinkChangedError,
  planAllocationEntry,
  recordAllocationChangesTx,
  type AllocationChange,
  type AllocationEntry,
  type AllocationSummary,
} from "./helpers/order-link-allocation.helper";

type AllocationResult = { changes: AllocationChange[]; warnings: string[]; summary: AllocationSummary };

/**
 * Gönderilmeyen açık bağın miktarı KORUNUR (kısmi güncelleme). Satır başına sıralı
 * `updateMany WHERE {id, unlinkedAt:null}`; 0 satır = bağ koparıldı → 409.
 */
async function applyAllocationsTx(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  entries: AllocationEntry[],
  ctx: WorkOrderEventCtx,
): Promise<AllocationResult> {
  const byLine = await loadAllocatableLinksTx(tx, workOrderId, entries);
  const changes: AllocationChange[] = [];
  const warnings: string[] = [];
  for (const e of entries) {
    const link = byLine.get(e.orderLineId)!;
    const orderNumber = link.orderLine.order.orderNumber;
    const plan = planAllocationEntry(link, e.allocatedQty);
    if (plan.warning) warnings.push(plan.warning);
    if (!plan.changed) continue;
    const w = await tx.workOrderToOrderLine.updateMany({
      where: { id: link.id, ...ACTIVE_ORDER_LINK },
      data: { allocatedQty: plan.to },
    });
    if (w.count === 0) throw orderLinkChangedError(orderNumber);
    changes.push({ orderLineId: e.orderLineId, orderNumber, from: Number(plan.from), to: Number(plan.to) });
  }
  // Tavan Σ yazımdan SONRA ölçülür; aşımda fırlatma tüm tx'i geri alır.
  const summary = await assertAllocationWithinBasisTx(tx, workOrderId);
  await recordAllocationChangesTx(tx, workOrderId, changes, ctx);
  return { changes, warnings, summary };
}

export async function setOrderLinkAllocations(
  workOrderId: string,
  allocations: AllocationEntry[],
  userId?: string,
): Promise<ApiResponse<{ changed: number; warnings: string[]; allocation: AllocationSummary }>> {
  if (allocations.length === 0) throw AppError.badRequest("En az bir sipariş satırı için metre girin.");
  const result = await prisma.$transaction(async (tx) => {
    // WO satır kilidi İLK ifade: tavan (giren metre) ve Σ eşzamanlı paylaştırma/top girişiyle yarışmasın.
    await touchWorkOrderTx(tx, workOrderId);
    return applyAllocationsTx(tx, workOrderId, allocations, { trigger: ORDER_ALLOCATION_TRIGGER, userId });
  });

  if (result.changes.length > 0) {
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      newData: { event: "ORDER_ALLOCATION_SET", changes: result.changes, allocation: result.summary },
    });
  }

  return {
    success: true,
    data: { changed: result.changes.length, warnings: result.warnings, allocation: result.summary },
    message:
      result.changes.length > 0
        ? `${result.changes.length} sipariş satırının paylaştırması kaydedildi.`
        : "Paylaştırma değişmedi.",
  };
}
