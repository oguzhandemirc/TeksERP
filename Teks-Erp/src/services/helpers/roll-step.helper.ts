// =============================================================================
// TeksERP - Roll-Step Helper
// =============================================================================
// Step durumunu (WorkOrderStep.status) artık iş-emri seviyesinde değil,
// o step'e ait rollerin RollMovement hareketleri üzerinden hesaplıyoruz.
//
// Kurallar:
//   - PENDING   → Step için hiç RollMovement açılmamış
//   - ACTIVE    → En az bir RollMovement açık (exitedAt = null)
//   - COMPLETED → Hiç açık movement yok, en az bir kapalı movement var,
//                 ve bu step'te ilerleyen roll sayısı iş emrindeki
//                 üretim içindeki rol sayısıyla eşit
//   - SKIPPED   → recompute değiştirmez; SKIPPED terminaldir, öyle kalır.
//
// Bu modül tüm çağrıcılar için ortak transaction client (Prisma.TransactionClient)
// kabul eder; atomik işlemler bozulmaz.
// =============================================================================
import { Prisma, RollStatus, StepStatus } from "@prisma/client";

export type TxClient = Prisma.TransactionClient;

/**
 * Belirtilen roll'ün belirtilen step'te açık (exitedAt=null) bir RollMovement
 * kaydı olup olmadığını döner. Operatör START basmış ama FINISH basmamışsa true.
 */
export async function isRollActiveInStep(
  tx: TxClient,
  rollId: string,
  stepId: string
): Promise<boolean> {
  const open = await tx.rollMovement.findFirst({
    where: { rollId, workOrderStepId: stepId, exitedAt: null },
    select: { id: true },
  });
  return !!open;
}

/**
 * Belirtilen roll'ün belirtilen step'te kapalı bir movement'i var mı?
 */
export async function hasRollCompletedStep(
  tx: TxClient,
  rollId: string,
  stepId: string
): Promise<boolean> {
  const closed = await tx.rollMovement.findFirst({
    where: { rollId, workOrderStepId: stepId, exitedAt: { not: null } },
    select: { id: true },
  });
  return !!closed;
}

/**
 * Step'e ait RollMovement kayıtlarına göre status'ü yeniden hesaplar ve
 * gerekirse günceller. SKIPPED step'lere dokunmaz.
 */
export async function recomputeStepStatus(
  tx: TxClient,
  stepId: string
): Promise<StepStatus> {
  const step = await tx.workOrderStep.findUnique({
    where: { id: stepId },
    select: {
      id: true,
      status: true,
      workOrderId: true,
      startedAt: true,
    },
  });
  if (!step) return StepStatus.PENDING;

  // SKIPPED ise terminal kabul edelim, değiştirmeyiz.
  if (step.status === StepStatus.SKIPPED) return StepStatus.SKIPPED;

  const [openCount, closedCount] = await Promise.all([
    tx.rollMovement.count({
      where: { workOrderStepId: stepId, exitedAt: null },
    }),
    tx.rollMovement.count({
      where: { workOrderStepId: stepId, exitedAt: { not: null } },
    }),
  ]);

  // Bu step'e henüz girmemiş ama iş emrinin üretimine dahil olan roller var mı?
  //   - currentStepId bu step'ten farklı ve
  //   - bu step için hiç movement kaydı yok (ne açık ne kapalı)
  // Böyle roller varsa step henüz bitmemiş, ACTIVE/PENDING'te kalmalı.
  const pendingRolls = await tx.roll.count({
    where: {
      // İş emrine bağlı = en az bir movement'i bu iş emrinin adımlarından birinde olmalı
      movements: { some: { step: { workOrderId: step.workOrderId } } },
      // Bu step için movement yok
      NOT: { movements: { some: { workOrderStepId: stepId } } },
      // Hala aktif üretimdeyse (PRODUCED/SCRAP dışı)
      status: {
        in: [
          RollStatus.IN_PRODUCTION,
          RollStatus.AT_SUBCONTRACTOR,
          RollStatus.RETURNED_FROM_SUBCONTRACTOR,
          RollStatus.A1_STOCK,
        ],
      },
    },
  });

  let nextStatus: StepStatus = step.status;

  if (openCount > 0) {
    nextStatus = StepStatus.ACTIVE;
  } else if (closedCount === 0 && pendingRolls === 0) {
    nextStatus = StepStatus.PENDING;
  } else if (closedCount > 0 && pendingRolls === 0) {
    // Tüm aktif roller bu step'i ya geçmiş ya atlamış
    nextStatus = StepStatus.COMPLETED;
  } else {
    // closedCount > 0 ama pendingRolls > 0 → hala bekleniyor → ACTIVE tut
    // veya closedCount === 0 ama pendingRolls > 0 → PENDING'ten çıkmadık
    nextStatus = closedCount > 0 ? StepStatus.ACTIVE : StepStatus.PENDING;
  }

  if (nextStatus !== step.status) {
    await tx.workOrderStep.update({
      where: { id: stepId },
      data: {
        status: nextStatus,
        startedAt:
          nextStatus === StepStatus.ACTIVE && !step.startedAt
            ? new Date()
            : undefined,
        completedAt:
          nextStatus === StepStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  return nextStatus;
}

/**
 * Bir roll için sonraki step'i açar:
 *   - Roll.currentStepId güncellenir
 *   - RollMovement.create (qtyIn, weightIn)
 *   - Next step PENDING ise recompute ile ACTIVE'e çekilir
 *
 * status ve rollStatus parametreleri çağıran tarafından verilir
 * (örneğin EXTERNAL step'e girişte durum farklı olabilir).
 */
export async function openMovementForNextStep(
  tx: TxClient,
  params: {
    rollId: string;
    nextStepId: string;
    qty: number;
    weight?: number | null;
    userId?: string | null;
    notes?: string | null;
    rollStatus?: RollStatus; // opsiyonel: yeni step'teki roll durumu
  }
): Promise<void> {
  const {
    rollId,
    nextStepId,
    qty,
    weight = null,
    userId = null,
    notes = null,
    rollStatus,
  } = params;

  await tx.rollMovement.create({
    data: {
      rollId,
      workOrderStepId: nextStepId,
      qtyIn: qty,
      weightIn: weight,
      operatorId: userId,
      notes,
    },
  });

  const rollData: Prisma.RollUncheckedUpdateInput = {
    currentStepId: nextStepId,
  };
  if (rollStatus) {
    rollData.status = rollStatus;
  }

  await tx.roll.update({
    where: { id: rollId },
    data: rollData,
  });

  await recomputeStepStatus(tx, nextStepId);
}

/**
 * WorkOrder'ın bu step'teki bir roll için önceki "açık" olup olmadığını
 * (movement tablo tabanlı) ve bu roll'ün step'e daha önce girip girmediğini
 * tek bir sorguda döndüren yardımcı (tablet uçlarında etkin-dışı düğmeler için).
 */
export async function getRollStepState(
  tx: TxClient,
  rollId: string,
  stepId: string
): Promise<{ active: boolean; completed: boolean }> {
  const [active, completed] = await Promise.all([
    isRollActiveInStep(tx, rollId, stepId),
    hasRollCompletedStep(tx, rollId, stepId),
  ]);
  return { active, completed };
}
