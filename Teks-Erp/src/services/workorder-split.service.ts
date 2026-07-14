// =============================================================================
// TeksERP — Parti Ayırma / Redye Servisi (workorder-split)
// =============================================================================
// Parti modeli redye/ayırma. Eski "dal (batchSplitId)" tabanlı splitBranch'in
// yerini alır. Üç mod (kullanıcı girdisi `mode`):
//   - REDYE_SAME_COLOR : aynı renk yeniden boyama — AYNI iş emri, YENİ parti.
//     Toplar boyahane adımına geri sarılır (WO klonu YOK). [BU DOSYADA UYGULANDI]
//   - NEW_COLOR        : farklı renk → yeni iş emri (WO klonu). [SONRAKİ İTERASYON]
//   - UNDYED_MOVE      : boyanmadan yeni iş emrine taşı (WO klonu). [SONRAKİ İTERASYON]
//
// loadSplitContext parti durumundan izinli modları + engel nedenini türetir.
// REDYE mekaniği eski koddan (movement rewind + rollError NO_CUT kapama) parti
// modeline uyarlandı: yeni parti createBatchTx ile doğar, kart audit'i tx DIŞI (F273).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, RollStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { createBatchTx, deleteIfEmptyAndTraceless } from "./batch.service";
import { recomputeStepStatus, ensureWorkOrderInProgress } from "./helpers/roll-step.helper";
import { ApiResponse } from "../types/api.types";

export type SplitMode = "REDYE_SAME_COLOR" | "NEW_COLOR" | "UNDYED_MOVE";

const LIVE_STATUSES: RollStatus[] = [RollStatus.IN_PRODUCTION, RollStatus.STOCK];

interface SplitContextRoll {
  id: string;
  status: RollStatus;
  currentStepId: string | null;
  currentQty: Prisma.Decimal;
  weightKg: Prisma.Decimal | null;
}

interface SplitContext {
  workOrderId: string;
  batchId: string;
  colorStep: { id: string; stepSequence: number } | null;
  rolls: SplitContextRoll[];
  rollStep: { id: string; stepSequence: number } | null;
  allowedModes: SplitMode[];
  blockReason: string | null;
}

export class WorkOrderSplitService {
  /**
   * Parti durumundan ayırma bağlamını çıkarır: renk-veren (boyahane) adım, partinin
   * canlı topları + bulundukları adım, ve HANGİ modların uygun olduğu + engel nedeni.
   */
  private async loadSplitContext(workOrderId: string, batchId: string): Promise<SplitContext> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        status: true,
        steps: {
          orderBy: { stepSequence: "asc" },
          select: {
            id: true,
            stepSequence: true,
            requiredCategory: { select: { appliesColor: true } },
          },
        },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: { workOrderId: true },
    });
    if (!batch || batch.workOrderId !== workOrderId) {
      throw AppError.notFound("Parti bu iş emrinde bulunamadı");
    }

    // Renk veren (boyahane) adım — redye'da geri sarılacak hedef.
    const colorStep = wo.steps.find((s) => s.requiredCategory?.appliesColor) ?? null;

    const rolls = await prisma.roll.findMany({
      where: {
        batchId,
        status: {
          notIn: [
            RollStatus.SUBCONTRACTOR_CONSUMED,
            RollStatus.TAMBUR_CONSUMED,
            RollStatus.CANCELLED,
            RollStatus.SHIPPED,
          ],
        },
      },
      select: { id: true, status: true, currentStepId: true, currentQty: true, weightKg: true },
      orderBy: { createdAt: "asc" },
    });

    // Partinin canlı toplarının bulunduğu adım (tek nokta beklenir).
    const rollStepIds = [...new Set(rolls.map((r) => r.currentStepId).filter((x): x is string => !!x))];
    const rollStep =
      rollStepIds.length === 1 ? wo.steps.find((s) => s.id === rollStepIds[0]) ?? null : null;

    const allowedModes: SplitMode[] = [];
    let blockReason: string | null = null;

    if (rolls.length === 0) {
      blockReason = "Bu partide ayrılacak aktif top yok.";
    } else if (!rollStep) {
      blockReason = "Parti topları farklı adımlarda — önce hepsi aynı noktada olmalı.";
    } else {
      const allLive = rolls.every((r) => LIVE_STATUSES.includes(r.status));
      const allAtSub = rolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR);
      // Boyandı/döndü (canlı, boyahane adımında veya sonrasında) → redye (aynı/yeni renk).
      if (allLive && colorStep && rollStep.stepSequence >= colorStep.stepSequence) {
        allowedModes.push("REDYE_SAME_COLOR", "NEW_COLOR");
      }
      // Boyanmadan fasonda bekliyor → yeni iş emrine taşı.
      if (allAtSub) {
        allowedModes.push("UNDYED_MOVE");
      }
      if (allowedModes.length === 0) {
        blockReason = colorStep
          ? "Parti bu durumda ayrılamaz (toplar boyahane sonrası canlı ya da fasonda bekliyor olmalı)."
          : "Rotada renk veren fason adımı (boyahane) yok — redye uygulanamaz.";
      }
    }

    return { workOrderId, batchId, colorStep, rolls, rollStep, allowedModes, blockReason };
  }

  /** Ayırma ÖNİZLEMESİ — hiçbir şeyi değiştirmez. İzinli modlar + taşınabilecek toplar. */
  async getSplitPreview(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
    const ctx = await this.loadSplitContext(workOrderId, batchId);
    return {
      success: true,
      data: {
        allowedModes: ctx.allowedModes,
        blockReason: ctx.blockReason,
        colorStepId: ctx.colorStep?.id ?? null,
        rollCount: ctx.rolls.length,
        rolls: ctx.rolls.map((r) => ({
          id: r.id,
          status: r.status,
          currentQty: Number(r.currentQty),
        })),
      },
    };
  }

  /** Partiyi ayır — moda göre yönlendirir. */
  async splitBranch(
    workOrderId: string,
    data: { batchId: string; mode: SplitMode; newColorId?: string | null; orderMode?: "stock" | "keep"; rollIds?: string[] },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const ctx = await this.loadSplitContext(workOrderId, data.batchId);
    if (!ctx.allowedModes.includes(data.mode)) {
      throw AppError.badRequest(
        ctx.blockReason ??
          `Bu parti için '${data.mode}' modu uygun değil. İzinli modlar: ${ctx.allowedModes.join(", ") || "yok"}`,
      );
    }

    if (data.mode === "REDYE_SAME_COLOR") {
      if (data.newColorId) {
        throw AppError.badRequest("Aynı renk yeniden boyamada yeni renk verilemez (NEW_COLOR kullanın).");
      }
      return this.redyeSameColor(ctx, data.rollIds, userId);
    }

    // NEW_COLOR / UNDYED_MOVE → yeni iş emri (WO klonu) gerektirir; sonraki iterasyon.
    throw AppError.conflict(
      `'${data.mode}' modu (yeni iş emrine boyama/taşıma) henüz hazır değil. Aynı-renk yeniden boyama (REDYE_SAME_COLOR) şu an kullanılabilir.`,
    );
  }

  /**
   * REDYE_SAME_COLOR: seçilen toplar AYNI iş emrinde YENİ partiye ayrılıp boyahane
   * adımına GERİ SARILIR (aynı renk yeniden boyanır). WO klonu YOK. Gidenler yeni P
   * (splitFrom=kaynak) + yeni kart alır; renk sıfırlanır (colorId=null → yeniden boyar).
   */
  private async redyeSameColor(
    ctx: SplitContext,
    rollIds: string[] | undefined,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const colorStep = ctx.colorStep!; // allowedModes REDYE içerdiyse colorStep var
    const selected =
      rollIds && rollIds.length > 0 ? ctx.rolls.filter((r) => rollIds.includes(r.id)) : ctx.rolls;
    if (selected.length === 0) throw AppError.badRequest("Yeniden boyanacak top seçilmedi");
    if (rollIds && selected.length !== rollIds.length) {
      throw AppError.badRequest("Seçilen toplardan bazıları bu partide/uygun değil — listeyi yenileyin.");
    }
    const selectedIds = selected.map((r) => r.id);

    const { newBatch, sourceDeleted } = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1) ATOMİK CLAIM: seçilenleri boyahane adımına geri sar (renk sıfırla).
        const claim = await tx.roll.updateMany({
          where: {
            id: { in: selectedIds },
            batchId: ctx.batchId,
            status: { in: LIVE_STATUSES },
          },
          data: {
            status: RollStatus.IN_PRODUCTION,
            currentStepId: colorStep.id,
            producedInStepId: colorStep.id,
            colorId: null,
          },
        });
        if (claim.count !== selectedIds.length) {
          throw AppError.conflict("Parti bu sırada başka bir işlemle değişti — redye iptal, sayfayı yenileyin.");
        }

        // 2) Yeni parti (aynı WO, splitFrom=kaynak). Kart WO başına — yeni kart yok.
        const created = await createBatchTx(tx, {
          workOrderId: ctx.workOrderId,
          rollIds: selectedIds,
          splitFromId: ctx.batchId,
          userId,
        });

        // 3) Movement rewind: açık movement'leri kapat + boyahanede taze aç.
        await tx.rollMovement.updateMany({
          where: { rollId: { in: selectedIds }, exitedAt: null },
          data: { exitedAt: new Date(), notes: "REDYE_REWIND" },
        });
        await tx.rollMovement.createMany({
          data: selected.map((r) => ({
            rollId: r.id,
            workOrderStepId: colorStep.id,
            qtyIn: r.currentQty,
            weightIn: r.weightKg ?? null,
            operatorId: userId ?? null,
            notes: "REDYE_REWIND_IN",
          })),
        });

        // 4) Açık RollError'ları NO_CUT ile kapat (redye'de kumaş yeniden boyanır;
        //    açık hata sayacı her redye'de kalıcı şişmesin — M-13 semantiği).
        await tx.rollError.updateMany({
          where: { rollId: { in: selectedIds }, isProcessed: false },
          data: { isProcessed: true, actionTaken: "NO_CUT", processedAtStepId: null, processedAt: new Date() },
        });

        // 5) Etkilenen adım statülerini yeniden hesapla + WO'yu IN_PROGRESS'e çek.
        const affected = [...new Set<string>([colorStep.id, ...selected.map((r) => r.currentStepId).filter((x): x is string => !!x)])];
        for (const sid of affected) await recomputeStepStatus(tx, sid);
        await ensureWorkOrderInProgress(tx, ctx.workOrderId);

        // 6) Kaynak parti boşaldıysa (izsiz) sil.
        const sourceDeleted = await deleteIfEmptyAndTraceless(tx, ctx.batchId);

        return { newBatch: created.batch, sourceDeleted };
      }),
    );

    // Audit tx DIŞINDA (F273).
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "BATCH",
      recordId: newBatch.id,
      newData: {
        batchNumber: newBatch.batchNumber,
        event: "REDYE_SAME_COLOR",
        splitFromId: ctx.batchId,
        rollCount: selectedIds.length,
        sourceDeleted,
      },
    });

    return {
      success: true,
      data: { newBatchId: newBatch.id, newBatchNumber: newBatch.batchNumber, sourceDeleted },
      message: `Parti yeniden boyamaya alındı: ${newBatch.batchNumber} (${selectedIds.length} top boyahaneye geri sarıldı)`,
    };
  }
}
