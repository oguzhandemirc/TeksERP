// =============================================================================
// Kat Tipini Değiştir — tablet Düzelt ailesi ("Eni Değiştir" ikizi), sebepli tek alan.
// =============================================================================
// Kat KOLONDUR (`WorkOrder.foldType`), hedef çeşit değeri değil: `PUT /:id/target-values` onu yazamaz.
// Kurallar genel PATCH ile aynı: katalog kanonikliği (`resolveFoldTypeForWrite`), Tambur başladıysa kilit
// (`computeWorkOrderLocks.foldType`, kilit altında yeniden), donmuş statü 409, kart bayatlar, hareket defteri + audit.
// =============================================================================
import { ReasonPresetKind } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { computeWorkOrderLocks, touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { PLAN_CHANGE_FROZEN_STATUSES, assertPlanChangeAllowed } from "./helpers/workorder-target-color.helper";
import { resolveFoldTypeForWrite } from "./helpers/fold-type";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { recordWorkOrderFieldDiffTx } from "./helpers/workorder-field-diff.helper";
import { resolveReasonCode } from "./reason-preset.service";
import { TERIM } from "../constants/terim";

const MIN_REASON_LENGTH = 3;

export async function changeWorkOrderFoldType(
  workOrderId: string,
  input: { foldType: string | null; reason: string; reasonCode?: string | null },
  userId?: string,
): Promise<ApiResponse<{ previousFoldType: string | null; foldType: string | null }>> {
  const { foldType: rawFoldType, reason } = input;
  if ((reason ?? "").trim().length < MIN_REASON_LENGTH) throw AppError.badRequest("Kat tipi değişikliği için sebep yazmalısınız.");
  const why = await resolveReasonCode(ReasonPresetKind.WORK_ORDER_PLAN_CHANGE, { reasonCode: input.reasonCode, reasonText: reason });
  const reasonText = (why.text ?? reason).trim();
  const foldType = (await resolveFoldTypeForWrite(rawFoldType)) ?? null;

  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { id: true, status: true, workOrderNumber: true, foldType: true } });
  if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
  assertPlanChangeAllowed(wo);
  if ((wo.foldType ?? null) === foldType) throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.ilgi} kat tipi zaten bu değerde.`);
  const locks = await computeWorkOrderLocks(prisma, workOrderId);
  if (locks.foldType) throw AppError.conflict(locks.reasons.foldType ?? "Kat tipi kilitli.");

  let previousFoldType: string | null = wo.foldType ?? null;
  await prisma.$transaction(async (tx) => {
    await touchWorkOrderTx(tx, workOrderId);
    // Kilit ALTINDA taze kilit (arada Tambur adımı başlamış olabilir — update.ts F58 deseni).
    const fresh = await computeWorkOrderLocks(tx, workOrderId);
    if (fresh.foldType) throw AppError.conflict(fresh.reasons.foldType ?? "Kat tipi kilitli.");
    const before = await tx.workOrder.findUnique({ where: { id: workOrderId }, select: { foldType: true } });
    previousFoldType = before?.foldType ?? null;
    const claim = await tx.workOrder.updateMany({
      where: { id: workOrderId, status: { notIn: PLAN_CHANGE_FROZEN_STATUSES } },
      data: { foldType },
    });
    if (claim.count === 0) throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada kapandı — kat tipi değiştirilemedi.`);
    await markTravelerCardDirtyTx(tx, workOrderId);
    await recordWorkOrderFieldDiffTx(tx, workOrderId, { before: { foldType: previousFoldType }, after: { foldType } }, {
      trigger: "FOLD_CHANGE",
      userId,
      reason: reasonText,
      reasonCode: why.code,
    });
  });

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "WORK_ORDER",
    recordId: workOrderId,
    oldData: { foldType: previousFoldType },
    newData: { event: "TARGET_FOLD_CHANGED", foldType, reason: reasonText },
  });

  return {
    success: true,
    data: { previousFoldType, foldType },
    message: `${TERIM.terbiyeIsEmri.cumleBasi.ilgi} kat tipi ${foldType ?? "—"} olarak güncellendi.`,
  };
}
