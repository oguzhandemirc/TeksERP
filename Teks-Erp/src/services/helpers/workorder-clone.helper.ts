// =============================================================================
// TeksERP — İş Emri Klon Yardımcısı (workorder-clone.helper)
// =============================================================================
// Parti ayırmanın "yeni iş emri" modları (NEW_COLOR / UNDYED_MOVE) kaynağın
// BİREBİR rotasını yeni bir WO'ya kopyalar ve partinin ayak izini (top konumu +
// movement + operation) yeni adımlara repoint eder. Emsal: parti-öncesi
// splitBranch (commit d65be4d, workorder.service.ts). Parti modeline uyarlandı:
//   - WO no artık `workOrderNumber` (İE + GGAAYY + NNNN), tx-içi üretici.
//   - dyehouseNote KOPYALANMAZ (O-9: kolon kaldırıldı, tek kaynak step.notes).
//   - Refakat kartı yeni WO'da doğar (createForWorkOrder, WO başına tek kart).
//
// "Kaldığı yerden devam" statüsü: S = reEntry adım sırası (boyahane). Yeni WO'da
// S öncesi adımlar COMPLETED, S ACTIVE, sonrası PENDING. recomputeStepStatus WO
// üyeliğini movement üzerinden okuduğundan movement repoint ZORUNLUDUR — eksik
// repoint kaynak WO'yu asla-tamamlanamaz bırakır.
// =============================================================================

import { Prisma, StepStatus, WorkOrderStatus } from "@prisma/client";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../../utils/code-format";
import { AppError } from "../../utils/app-error";
import { TravelerCardService } from "../traveler-card.service";

const travelerCardService = new TravelerCardService();

/**
 * İş emri no üretici (İE + GGAAYY + NNNN) — tx İÇİNDE, sequence okuması closure
 * içinde (withBarcodeRetry kapsamında). `generateBatchNumberTx` (batch.service)
 * aynası, prefix "IE". Split servisinden çağrılır — workorder.service'ten import
 * ETMEYİN (döngüsel bağımlılık).
 */
export async function generateWorkOrderNumberTx(
  tx: Prisma.TransactionClient,
  date: Date,
): Promise<string> {
  const prefix = dailyCodePrefix("IE", date);
  const todays = await tx.workOrder.findMany({
    where: { workOrderNumber: { gte: prefix, startsWith: prefix } },
    select: { workOrderNumber: true },
  });
  const seq = nextDailySeq(
    todays.map((w) => w.workOrderNumber),
    prefix,
  );
  return buildDailyCode("IE", seq, date);
}

export interface CloneWorkOrderResult {
  newWo: { id: string; workOrderNumber: string };
  /** Eski adım id → yeni adım id (aynı stepSequence). Repoint için. */
  oldToNew: Map<string, string>;
  /** Yeni WO'da reEntry (S) adımının id'si — parti buraya sarılır/taşınır. */
  newReEntryStepId: string;
}

/**
 * Kaynak WO'nun birebir rotasıyla yeni bir WO doğurur (İE + kart dahil) ve
 * eski→yeni adım eşlemesini döner. Roll/movement repoint'i ÇAĞIRAN yapar
 * (repointRollsTx) — bu yardımcı yalnız WO + adım + kart kopyalar.
 *
 * @param reEntryStepSequence S — "kaldığı yer"; S öncesi COMPLETED, S ACTIVE.
 * @param targetColorId       yeni WO'nun hedef rengi (NEW_COLOR = yeni renk,
 *                            UNDYED_MOVE = kaynak renk).
 * @param orderMode           "keep" → sipariş bağları + tip kopyalanır; "stock"
 *                            → STOCK_PRODUCTION, bağ kopar.
 * @param movedTotalQty       yeni WO targetQuantity (taşınan topların toplamı).
 */
export async function cloneWorkOrderTx(
  tx: Prisma.TransactionClient,
  params: {
    sourceWorkOrderId: string;
    reEntryStepSequence: number;
    targetColorId: string | null;
    orderMode: "stock" | "keep";
    movedTotalQty: number;
    userId?: string;
    date?: Date;
  },
): Promise<CloneWorkOrderResult> {
  const now = params.date ?? new Date();
  const src = await tx.workOrder.findUnique({
    where: { id: params.sourceWorkOrderId },
    select: {
      id: true,
      type: true,
      width: true,
      targetWeight: true,
      parameters: true,
      plannedStartDate: true,
      plannedEndDate: true,
      routeTemplateId: true,
      targetItemId: true,
      foldType: true,
      steps: {
        orderBy: { stepSequence: "asc" },
        select: {
          id: true,
          stationId: true,
          stepSequence: true,
          notes: true,
          stepData: true,
          requiredCategoryId: true,
          plannedSubcontractorId: true,
        },
      },
      targetProperties: { select: { propertyId: true } },
      orderLinks: { select: { orderLineId: true, allocatedQty: true } },
    },
  });
  if (!src) throw AppError.notFound("Kaynak iş emri bulunamadı");

  const S = params.reEntryStepSequence;
  const newType = params.orderMode === "keep" ? src.type : "STOCK_PRODUCTION";

  const newWo = await tx.workOrder.create({
    data: {
      workOrderNumber: await generateWorkOrderNumberTx(tx, now),
      type: newType,
      width: src.width,
      targetWeight: src.targetWeight,
      targetQuantity: new Prisma.Decimal(params.movedTotalQty),
      parameters: (src.parameters as Prisma.InputJsonValue) ?? undefined,
      status: WorkOrderStatus.IN_PROGRESS,
      plannedStartDate: src.plannedStartDate,
      plannedEndDate: src.plannedEndDate,
      routeTemplateId: src.routeTemplateId,
      targetItemId: src.targetItemId,
      targetColorId: params.targetColorId,
      foldType: src.foldType,
      // Soy bağı: eski refakat kartı okutulunca Fason Kabul bu WO'yu da bulur
      // (listPendingReturns BFS); kaynak WO'nun ayrılma izi buradan okunur.
      splitFromId: src.id,
      steps: {
        create: src.steps.map((s) => ({
          stationId: s.stationId,
          stepSequence: s.stepSequence,
          notes: s.notes,
          stepData: (s.stepData as Prisma.InputJsonValue) ?? undefined,
          requiredCategoryId: s.requiredCategoryId ?? null,
          plannedSubcontractorId: s.plannedSubcontractorId ?? null,
          status:
            s.stepSequence < S
              ? StepStatus.COMPLETED
              : s.stepSequence === S
                ? StepStatus.ACTIVE
                : StepStatus.PENDING,
          startedAt: s.stepSequence === S ? now : null,
          completedAt: s.stepSequence < S ? now : null,
        })),
      },
      ...(src.targetProperties.length > 0
        ? {
            targetProperties: {
              create: src.targetProperties.map((p) => ({ propertyId: p.propertyId })),
            },
          }
        : {}),
      ...(params.orderMode === "keep" && src.orderLinks.length > 0
        ? {
            orderLinks: {
              create: src.orderLinks.map((l) => ({
                orderLineId: l.orderLineId,
                allocatedQty: l.allocatedQty,
              })),
            },
          }
        : {}),
    },
    select: {
      id: true,
      workOrderNumber: true,
      steps: { orderBy: { stepSequence: "asc" }, select: { id: true, stepSequence: true } },
    },
  });

  const newStepBySeq = new Map(newWo.steps.map((s) => [s.stepSequence, s.id] as const));
  const oldToNew = new Map<string, string>();
  for (const s of src.steps) {
    const nid = newStepBySeq.get(s.stepSequence);
    if (nid) oldToNew.set(s.id, nid);
  }
  const newReEntryStepId = newStepBySeq.get(S);
  if (!newReEntryStepId) {
    throw AppError.badRequest("Yeni iş emrinde geri-sarım adımı bulunamadı (rota kopyası tutarsız)");
  }

  // Yeni WO açılışında refakat kartı doğar (WO başına tek kart, idempotent).
  await travelerCardService.createForWorkOrder(tx, newWo.id, params.userId);

  return {
    newWo: { id: newWo.id, workOrderNumber: newWo.workOrderNumber },
    oldToNew,
    newReEntryStepId,
  };
}

/**
 * Taşınan topların TÜM ayak izini (top konumu + movement + operation) kaynağın
 * adımlarından yeni WO'nun aynı sıradaki adımlarına repoint eder. recomputeStepStatus
 * WO üyeliğini movement üzerinden okuduğundan bu ŞARTTIR — aksi hâlde kaynak WO'nun
 * adımları "hâlâ bekleyen top var" sanır ve asla COMPLETED olmaz (R1).
 */
export async function repointRollsTx(
  tx: Prisma.TransactionClient,
  rollIds: string[],
  oldToNew: Map<string, string>,
): Promise<void> {
  for (const [oldId, newId] of oldToNew) {
    await tx.roll.updateMany({
      where: { id: { in: rollIds }, currentStepId: oldId },
      data: { currentStepId: newId },
    });
    await tx.roll.updateMany({
      where: { id: { in: rollIds }, producedInStepId: oldId },
      data: { producedInStepId: newId },
    });
    await tx.rollMovement.updateMany({
      where: { rollId: { in: rollIds }, workOrderStepId: oldId },
      data: { workOrderStepId: newId },
    });
    await tx.rollOperation.updateMany({
      where: { rollId: { in: rollIds }, workOrderStepId: oldId },
      data: { workOrderStepId: newId },
    });
    // RollError adım referansları da yeni WO'ya taşınır — aksi hâlde kalite raporu
    // (detectedAtStepId) hatayı kaynak WO'ya atfeder (B6).
    await tx.rollError.updateMany({
      where: { rollId: { in: rollIds }, detectedAtStepId: oldId },
      data: { detectedAtStepId: newId },
    });
    await tx.rollError.updateMany({
      where: { rollId: { in: rollIds }, processedAtStepId: oldId },
      data: { processedAtStepId: newId },
    });
  }
}
