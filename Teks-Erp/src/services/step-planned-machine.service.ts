// =============================================================================
// İş emri adımının önerilen makinesi (Gülkesim 2026-11-02) — planlamacı sonradan değiştirir.
// Yalnız öneri: fiilî makine tablet oturumundan; engel/uyarı yok.
// =============================================================================
import { StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { assertPlannedMachines } from "./helpers/planned-machine.helper";
import type { ApiResponse } from "../types/api.types";

export interface StepPlannedMachineResult {
  stepId: string;
  plannedMachineId: string | null;
  plannedMachineName: string | null;
}

/** Değişebilir adım: bekleyen ya da sürmekte; kapanmış/atlanmış adımın önerisi tarihtir. */
const OPEN_STEP_STATUSES: StepStatus[] = [StepStatus.PENDING, StepStatus.ACTIVE];
const DEAD_WO_STATUSES: WorkOrderStatus[] = [
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.CANCELLED,
  WorkOrderStatus.SUPERSEDED,
];

export async function updateStepPlannedMachine(
  workOrderId: string,
  stepId: string,
  plannedMachineId: string | null,
  userId?: string,
): Promise<ApiResponse<StepPlannedMachineResult>> {
  const step = await prisma.workOrderStep.findUnique({
    where: { id: stepId },
    select: { id: true, workOrderId: true, stationId: true, plannedMachineId: true },
  });
  if (!step || step.workOrderId !== workOrderId) throw AppError.notFound("Adım bulunamadı");
  await assertPlannedMachines(prisma, [{ stationId: step.stationId, plannedMachineId }]);

  // ATOMİK CLAIM: adım açık + İE canlı + istasyon değişmemiş WHERE'de; yarışı kaybeden 409.
  const claim = await prisma.workOrderStep.updateMany({
    where: {
      id: stepId,
      workOrderId,
      stationId: step.stationId,
      status: { in: OPEN_STEP_STATUSES },
      workOrder: { status: { notIn: DEAD_WO_STATUSES } },
    },
    data: { plannedMachineId },
  });
  if (claim.count === 0) {
    throw AppError.conflict("Adım kapanmış ya da iş emri sonlanmış — makine önerisi değiştirilemez. Sayfayı yenileyin.", {
      code: "STEP_NOT_OPEN",
    });
  }

  const machine = plannedMachineId
    ? await prisma.machine.findUnique({ where: { id: plannedMachineId }, select: { name: true } })
    : null;

  await AuditService.log({
    userId,
    action: "UPDATE",
    tableName: "WORK_ORDER_STEP",
    recordId: stepId,
    oldData: { plannedMachineId: step.plannedMachineId },
    newData: { plannedMachineId },
  });

  return {
    success: true,
    data: { stepId, plannedMachineId, plannedMachineName: machine?.name ?? null },
    message: plannedMachineId ? "Makine önerisi kaydedildi" : "Makine önerisi kaldırıldı",
  };
}
