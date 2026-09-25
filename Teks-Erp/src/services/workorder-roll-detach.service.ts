// =============================================================================
// TOP ÇIKAR — yanlış okutulan topu iş emrinden geri almak (hareket defteri D6, tasarım §6.2)
// =============================================================================
// Yalnız bu iş emrinde HİÇ işlem görmemiş top çıkar: ilk adımda, en fazla bir AÇIK giriş
// hareketi; işlem/kesim/fason/çuval/sapma yok. Giriş hareketi DAMGALANIR (silinmez), stok
// defterindeki üretime giriş satırı BAĞLI TERS satırla kapanır (`ROLL_DETACH`) ve top o satırın
// `from` ucundaki durum/depoya döner. İş emrinde top kalmaz ve hiçbir adım başlamamışsa iş emri
// PLANNED'a döner (hareket defterine STATUS_CHANGED). İşlem görmüş top için yol panelde:
// Konumu Düzelt / Parti Düşür.
// =============================================================================

import { Prisma, RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { STOCK_MOVE_REASON } from "../constants/stock-move-reasons";
import { ACTIVE_MOVEMENT, revokeRollMovements } from "./helpers/roll-movement.helper";
import { ACTIVE_OPERATION } from "./helpers/roll-operation.helper";
import { reverseStockMove } from "./helpers/warehouse-ledger-reverse.helper";
import { findOpenProductionIssueTx } from "./helpers/production-issue-ledger.helper";
import { recomputeStepStatus } from "./helpers/roll-step.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { claimWorkOrderStatusTx } from "./helpers/workorder-event.helper";
import { deleteIfEmptyAndTracelessTx } from "./batch.service";

type Db = Prisma.TransactionClient | typeof prisma;

const MIN_REASON_LENGTH = 3;
const FROZEN: readonly WorkOrderStatus[] = [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED];

interface WoSteps {
  id: string;
  status: WorkOrderStatus;
  workOrderNumber: string;
  steps: { id: string; stepSequence: number }[];
}

interface DetachRoll {
  id: string;
  barcode: string | null;
  status: RollStatus;
  currentStepId: string | null;
  sackId: string | null;
  shipmentId: string | null;
  batchId: string | null;
  currentQty: Prisma.Decimal;
}

const ROLL_SELECT = {
  id: true, barcode: true, status: true, currentStepId: true, sackId: true, shipmentId: true, batchId: true, currentQty: true,
} as const;

async function loadWo(db: Db, workOrderId: string): Promise<WoSteps> {
  const wo = await db.workOrder.findUnique({
    where: { id: workOrderId },
    select: { id: true, status: true, workOrderNumber: true, steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } },
  });
  if (!wo) throw AppError.notFound("İş emri bulunamadı");
  return wo;
}

/**
 * Topun bu iş emrinde işlem gördüğünü söyleyen sebepler (boş = çıkarılabilir). Liste ucu ve
 * yazım aynı yüklemden geçer; yazımda iş emri satırı kilitliyken TAZE koşar.
 */
async function detachBlockers(db: Db, roll: DetachRoll, wo: WoSteps): Promise<string[]> {
  const stepIds = wo.steps.map((s) => s.id);
  const out: string[] = [];
  if (roll.status !== RollStatus.IN_PRODUCTION) out.push("üretimde değil");
  if (roll.currentStepId !== wo.steps[0]?.id) out.push("ilk adımı geçti");
  if (roll.sackId || roll.shipmentId) out.push("çuvalda / sevkte");
  const moves = await db.rollMovement.findMany({
    where: { rollId: roll.id, workOrderStepId: { in: stepIds }, ...ACTIVE_MOVEMENT },
    select: { exitedAt: true },
  });
  if (moves.length > 1 || moves.some((m) => m.exitedAt !== null)) out.push("istasyonda işlem gördü");
  if ((await db.rollOperation.count({ where: { rollId: roll.id, workOrderStepId: { in: stepIds }, ...ACTIVE_OPERATION } })) > 0) {
    out.push("işlem kaydı var");
  }
  if ((await db.roll.count({ where: { parentRollId: roll.id } })) > 0) out.push("kesildi");
  if ((await db.subcontractorDispatchItem.count({ where: { rollId: roll.id, dispatch: { cancelledAt: null } } })) > 0) {
    out.push("fasona sevk edildi");
  }
  if ((await db.rollVariance.count({ where: { rollId: roll.id, workOrderStepId: { in: stepIds } } })) > 0) out.push("sapma kaydı var");
  return out;
}

/** Defter satırı yoksa (depo/stok dışı top) önceki durum, üretime girişin durum olayından. */
async function statusBeforeEntry(tx: Prisma.TransactionClient, rollId: string): Promise<RollStatus | null> {
  const ev = await tx.rollStatusEvent.findFirst({
    where: { rollId, toStatus: RollStatus.IN_PRODUCTION },
    orderBy: { createdAt: "desc" },
    select: { fromStatus: true },
  });
  return ev?.fromStatus ?? null;
}

export class WorkOrderRollDetachService {
  /** Top Çıkar önizlemesi — iş emrindeki her top, çıkarılabilir mi, değilse neden. Yazmaz. */
  async listCandidates(workOrderId: string) {
    const wo = await loadWo(prisma, workOrderId);
    const rolls = await prisma.roll.findMany({
      where: { currentStep: { workOrderId } },
      select: ROLL_SELECT,
      orderBy: { barcode: "asc" },
    });
    const data = [];
    for (const r of rolls) {
      const blockers = FROZEN.includes(wo.status) ? ["iş emri kapalı"] : await detachBlockers(prisma, r, wo);
      data.push({ id: r.id, barcode: r.barcode, currentQty: Number(r.currentQty), status: r.status, detachable: blockers.length === 0, blockers });
    }
    return { success: true, data };
  }

  /** Topu iş emrinden çıkarır — tek tx, iş emri satırı kilidi İLK ifade. */
  async detachRoll(workOrderId: string, rollId: string, reason: string, userId?: string) {
    const why = (reason ?? "").trim();
    if (why.length < MIN_REASON_LENGTH) throw AppError.badRequest("Top çıkarmak için sebep yazmalısınız.");
    const result = await prisma.$transaction((tx) => this.detachTx(tx, { workOrderId, rollId, why, userId }));
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      oldData: { status: RollStatus.IN_PRODUCTION, workOrderId },
      newData: { event: "ROLL_DETACHED_FROM_WO", status: result.status, reason: why, workOrderReverted: result.workOrderReverted },
    });
    return {
      success: true,
      data: result,
      message: `${result.barcode ?? "Top"} iş emrinden çıkarıldı${result.workOrderReverted ? " — iş emrinde top kalmadı, Planlandı'ya döndü" : ""}.`,
    };
  }

  private async detachTx(tx: Prisma.TransactionClient, input: { workOrderId: string; rollId: string; why: string; userId?: string }) {
    const { workOrderId, rollId, why, userId } = input;
    await touchWorkOrderTx(tx, workOrderId);
    const wo = await loadWo(tx, workOrderId);
    if (FROZEN.includes(wo.status)) throw AppError.conflict("Tamamlanmış ya da iptal edilmiş iş emrinden top çıkarılamaz.");
    const roll = await tx.roll.findUnique({ where: { id: rollId }, select: ROLL_SELECT });
    const first = wo.steps[0];
    if (!roll || !first || !wo.steps.some((s) => s.id === roll.currentStepId)) throw AppError.notFound("Bu top bu iş emrinde değil.");
    const blockers = await detachBlockers(tx, roll, wo);
    if (blockers.length > 0) {
      throw AppError.conflict(`Bu top işlem gördü (${blockers.join(", ")}) — panelden Konumu Düzelt ya da Parti Düşür kullanın.`, {
        code: "ROLL_DETACH_PROCESSED",
        blockers,
      });
    }
    const issue = await findOpenProductionIssueTx(tx, rollId, [first.id]);
    const backStatus = issue?.fromStatus ?? (await statusBeforeEntry(tx, rollId));
    if (!backStatus) throw AppError.conflict("Topun iş emrinden önceki durumu bulunamadı — panelden Konumu Düzelt kullanın.");
    const claim = await tx.roll.updateMany({
      where: { id: rollId, status: RollStatus.IN_PRODUCTION, currentStepId: first.id },
      data: {
        status: backStatus,
        currentStepId: null,
        producedInStepId: null,
        batchId: null,
        ...(issue?.fromWarehouseId ? { warehouseId: issue.fromWarehouseId } : {}),
      },
    });
    if (claim.count === 0) throw AppError.conflict("Top bu sırada değişti — ekranı yenileyip tekrar deneyin.");
    if (issue) await reverseStockMove(tx, issue.id, { reasonCode: STOCK_MOVE_REASON.ROLL_DETACH, userId: userId ?? null, notes: why.slice(0, 300) });
    await revokeRollMovements(tx, { rollIds: [rollId], workOrderStepIds: wo.steps.map((s) => s.id), reason: `Top çıkar: ${why}`, userId });
    await recomputeStepStatus(tx, first.id);
    if (roll.batchId) await deleteIfEmptyAndTracelessTx(tx, roll.batchId);
    await markTravelerCardDirtyTx(tx, workOrderId);
    const workOrderReverted = await this.revertIfEmptyTx(tx, workOrderId, why, userId);
    return { rollId, barcode: roll.barcode, status: backStatus, workOrderReverted };
  }

  /** Top kalmadı ve hiçbir adım başlamadıysa iş emri Planlandı'ya döner (başlama satırının karşı kaydı). */
  private async revertIfEmptyTx(tx: Prisma.TransactionClient, workOrderId: string, why: string, userId?: string): Promise<boolean> {
    const remaining = await tx.roll.count({ where: { currentStep: { workOrderId } } });
    if (remaining > 0) return false;
    const started = await tx.workOrderStep.count({ where: { workOrderId, status: { not: StepStatus.PENDING } } });
    if (started > 0) return false;
    const from = await claimWorkOrderStatusTx(tx, workOrderId, {
      from: [WorkOrderStatus.IN_PROGRESS],
      to: WorkOrderStatus.PLANNED,
      ctx: { trigger: "ROLL_DETACH", userId, reason: why },
    });
    return from !== null;
  }
}

export const workOrderRollDetachService = new WorkOrderRollDetachService();
