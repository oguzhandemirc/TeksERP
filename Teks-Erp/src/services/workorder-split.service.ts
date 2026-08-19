// =============================================================================
// TeksERP — Parti Ayırma / Redye Servisi (workorder-split)
// =============================================================================
// Parti modeli redye/ayırma. Üç mod (kullanıcı girdisi `mode`):
//   - REDYE_SAME_COLOR : aynı renk yeniden boyama (tebdil) — AYNI iş emri, YENİ
//     parti. Seçili toplar boyahane adımına GERİ SARILIR (WO klonu YOK).
//   - NEW_COLOR        : farklı renk → YENİ iş emri (WO klonu). Toplar yeni WO'nun
//     boyahane adımına geri sarılır (renk sıfırlanır, kabulde yeni renk uygulanır).
//   - UNDYED_MOVE      : toplar hâlâ fasonda (boyanmamış) → YENİ iş emrine taşınır;
//     parti + açık sevk bütünüyle taşınır, kabul yeni WO'da yapılır.
//
// loadSplitContext parti durumundan izinli modları PER-ROLL uygunlukla türetir
// (karma-adım partide uygun toplar ayrılabilir). Depo-tebdili: boyahane son adımsa
// dönen top WAREHOUSE'a düşer; çuvalda/sevkte OLMAYAN depo topu tekrar boyanabilir.
// WO klonu + repoint mekaniği ./helpers/workorder-clone.helper.ts'te.
// Kart WO başına (parti kart üretmez); audit tx DIŞINDA (F273).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, RollStatus, WorkOrderStatus, TravelerCardStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import {
  createBatchTx,
  deleteIfEmptyAndTraceless,
  NO_LIVE_MATERIAL_STATUSES,
} from "./batch.service";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { recomputeStepStatus, ensureWorkOrderInProgress } from "./helpers/roll-step.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
import { cloneWorkOrderTx, repointRollsTx } from "./helpers/workorder-clone.helper";
import { ApiResponse } from "../types/api.types";

export type SplitMode = "REDYE_SAME_COLOR" | "NEW_COLOR" | "UNDYED_MOVE";

// Redye / NEW_COLOR için uygun statüler. WAREHOUSE dahil (depo-tebdili). Fasondaki
// (AT_SUBCONTRACTOR) toplar bu listede DEĞİL — onlar yalnız UNDYED_MOVE ile taşınır.
const REDYE_ELIGIBLE_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  RollStatus.STOCK,
  RollStatus.WAREHOUSE,
];

interface SplitContextRoll {
  id: string;
  status: RollStatus;
  currentStepId: string | null;
  producedInStepId: string | null;
  currentQty: Prisma.Decimal;
  weightKg: Prisma.Decimal | null;
  sackId: string | null;
  shipmentId: string | null;
  /** Redye / NEW_COLOR için uygun mu (statü + çuval/sevk yok + boyahane adımında/sonrasında). */
  redyeEligible: boolean;
}

interface SplitContext {
  workOrderId: string;
  batchId: string;
  batchNumber: string;
  sourceTargetColorId: string | null;
  colorStep: { id: string; stepSequence: number } | null;
  rolls: SplitContextRoll[];
  /** Fasondaki (AT_SUBCONTRACTOR) topların TEK adımı — UNDYED_MOVE reEntry. */
  atSubStep: { id: string; stepSequence: number } | null;
  allowedModes: SplitMode[];
  blockReason: string | null;
}

export class WorkOrderSplitService {
  /**
   * Parti durumundan ayırma bağlamını çıkarır: renk-veren (boyahane) adım, partinin
   * topları + PER-ROLL uygunluk (redyeEligible), fasondaki topların adımı, ve HANGİ
   * modların uygun olduğu + engel nedeni.
   */
  private async loadSplitContext(workOrderId: string, batchId: string): Promise<SplitContext> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        status: true,
        targetColorId: true,
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
      select: { workOrderId: true, batchNumber: true },
    });
    if (!batch || batch.workOrderId !== workOrderId) {
      throw AppError.notFound("Parti bu iş emrinde bulunamadı");
    }

    // Renk veren (boyahane) adım — redye/yeni-renk'te geri sarılacak hedef.
    const colorStep = wo.steps.find((s) => s.requiredCategory?.appliesColor) ?? null;
    const stepSeqById = new Map(wo.steps.map((s) => [s.id, s.stepSequence] as const));

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
      select: {
        id: true,
        status: true,
        currentStepId: true,
        producedInStepId: true,
        currentQty: true,
        weightKg: true,
        sackId: true,
        shipmentId: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Topun rota konumu — canlı ise currentStep, final (depo) ise producedInStep.
    const seqOf = (r: { currentStepId: string | null; producedInStepId: string | null }): number | null => {
      const sid = r.currentStepId ?? r.producedInStepId;
      return sid ? stepSeqById.get(sid) ?? null : null;
    };

    const ctxRolls: SplitContextRoll[] = rolls.map((r) => {
      const seq = seqOf(r);
      const redyeEligible =
        !!colorStep &&
        REDYE_ELIGIBLE_STATUSES.includes(r.status) &&
        r.sackId === null &&
        r.shipmentId === null &&
        seq !== null &&
        seq >= colorStep.stepSequence;
      return { ...r, redyeEligible };
    });

    // Fasondaki topların TEK adımı (UNDYED_MOVE tüm-parti taşır; tek açık sevk).
    const atSubRolls = ctxRolls.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR);
    const atSubStepIds = [...new Set(atSubRolls.map((r) => r.currentStepId).filter((x): x is string => !!x))];
    const atSubStep =
      atSubStepIds.length === 1 ? wo.steps.find((s) => s.id === atSubStepIds[0]) ?? null : null;

    const allowedModes: SplitMode[] = [];
    let blockReason: string | null = null;

    const redyeCount = ctxRolls.filter((r) => r.redyeEligible).length;
    const allAtSub = ctxRolls.length > 0 && ctxRolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR);

    if (ctxRolls.length === 0) {
      blockReason = "Bu partide ayrılacak aktif top yok.";
    } else {
      if (colorStep && redyeCount > 0) allowedModes.push("REDYE_SAME_COLOR", "NEW_COLOR");
      if (colorStep && allAtSub && atSubStep) allowedModes.push("UNDYED_MOVE");
      if (allowedModes.length === 0) {
        blockReason = !colorStep
          ? "Rotada renk veren fason adımı (boyahane) yok — yeniden boyama/ayırma uygulanamaz."
          : allAtSub && !atSubStep
            ? "Fasondaki toplar farklı adımlarda — birlikte taşınamaz."
            : "Parti bu durumda ayrılamaz (toplar boyahane sonrası canlı/depoda ya da tümü fasonda bekliyor olmalı; çuvaldaki/sevkteki top ayrılamaz).";
      }
    }

    return {
      workOrderId,
      batchId,
      batchNumber: batch.batchNumber,
      sourceTargetColorId: wo.targetColorId,
      colorStep,
      rolls: ctxRolls,
      atSubStep,
      allowedModes,
      blockReason,
    };
  }

  /** Ayırma ÖNİZLEMESİ — hiçbir şeyi değiştirmez. İzinli modlar + PER-ROLL uygunluk. */
  async getSplitPreview(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
    const ctx = await this.loadSplitContext(workOrderId, batchId);
    return {
      success: true,
      data: {
        allowedModes: ctx.allowedModes,
        blockReason: ctx.blockReason,
        colorStepId: ctx.colorStep?.id ?? null,
        sourceTargetColorId: ctx.sourceTargetColorId,
        rollCount: ctx.rolls.length,
        eligibleCount: ctx.rolls.filter((r) => r.redyeEligible).length,
        rolls: ctx.rolls.map((r) => ({
          id: r.id,
          status: r.status,
          currentQty: Number(r.currentQty),
          currentStepId: r.currentStepId,
          eligible: r.redyeEligible,
        })),
      },
    };
  }

  /** Partiyi ayır — moda göre yönlendirir. */
  async splitBranch(
    workOrderId: string,
    data: {
      batchId: string;
      mode: SplitMode;
      newColorId?: string | null;
      orderMode?: "stock" | "keep";
      rollIds?: string[];
      reason?: string;
    },
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
      return this.redyeSameColor(ctx, data.rollIds, data.reason, userId);
    }

    if (data.mode === "NEW_COLOR") {
      if (!data.newColorId) {
        throw AppError.badRequest("Farklı renge boyama için yeni renk seçilmeli.");
      }
      return this.newColorRedye(ctx, data.newColorId, data.orderMode ?? "stock", data.rollIds, data.reason, userId);
    }

    // UNDYED_MOVE
    if (data.newColorId) {
      throw AppError.badRequest("Boyanmadan taşımada renk verilemez (boyama yeni iş emrinde yapılır).");
    }
    return this.undyedMove(ctx, data.orderMode ?? "stock", data.rollIds, data.reason, userId);
  }

  /**
   * Tam-parti ayırma sonrası BOŞALAN kaynak WO'yu DEVREDER (B1): hiç canlı top
   * kalmadıysa ve WO hâlâ açıksa (PLANNED/IN_PROGRESS) → SUPERSEDED + kart VOIDED.
   * CANCELLED DEĞİL — veri kaybı yok, tüm malzeme yeni (devam) iş emrine taşındı
   * (WorkOrder.splitFromId ile bağlı). "İptal" yanıltıcı olurdu; SUPERSEDED terminal
   * ama rapor/filtrede iptalle karışmaz. COMPLETED WO'ya (depo-tebdilinde kalan depo
   * topları) DOKUNMAZ. Döner: devredildi mi.
   */
  private async supersedeEmptiedSourceWorkOrderTx(
    tx: Prisma.TransactionClient,
    workOrderId: string,
  ): Promise<boolean> {
    // ⚠️ Küme TEK KAYNAKTAN (`NO_LIVE_MATERIAL_STATUSES`). Satır içi yazılıyken
    // `KARTELA_CONSUMED` EKSİKTİ: son topu kartelaya giden iş emri kalıcı olarak
    // "boş değil" sayılıyor ve hiç SUPERSEDED olamıyordu — sessiz, kimsenin
    // bakmadığı bir kilitlenme.
    const liveRolls = await tx.roll.count({
      where: {
        batch: { workOrderId },
        status: { notIn: NO_LIVE_MATERIAL_STATUSES },
      },
    });
    if (liveRolls > 0) return false;
    const res = await tx.workOrder.updateMany({
      where: { id: workOrderId, status: { in: [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS] } },
      data: { status: WorkOrderStatus.SUPERSEDED },
    });
    if (res.count === 0) return false;
    await setWorkOrderCardStatuses(
      tx,
      workOrderId,
      [TravelerCardStatus.ACTIVE],
      TravelerCardStatus.VOIDED,
      { voidReason: "Tüm partiler yeni iş emrine ayrıldı" },
    );
    return true;
  }

  /** Seçilen uygun topları döndürür veya net 400 fırlatır (redye/yeni-renk ortak). */
  private resolveEligibleSelection(ctx: SplitContext, rollIds: string[] | undefined): SplitContextRoll[] {
    const eligible = ctx.rolls.filter((r) => r.redyeEligible);
    const selected = rollIds && rollIds.length > 0 ? eligible.filter((r) => rollIds.includes(r.id)) : eligible;
    if (selected.length === 0) throw AppError.badRequest("İşleme uygun top yok.");
    if (rollIds && selected.length !== rollIds.length) {
      throw AppError.badRequest(
        "Seçilen toplardan bazıları uygun değil (çuvalda/sevkte ya da boyahane öncesinde) — listeyi yenileyin.",
      );
    }
    return selected;
  }

  /**
   * REDYE_SAME_COLOR (tebdil): seçilen uygun toplar AYNI iş emrinde YENİ partiye
   * ayrılıp boyahane adımına GERİ SARILIR (aynı renk yeniden boyanır). WO klonu YOK.
   * Renk sıfırlanır (colorId=null → kabulde yeniden aynı hedef rengi kazanır). Depo
   * (WAREHOUSE) topu da tebdil edilebilir → WO tümüyle bitmişse geri açılır.
   */
  private async redyeSameColor(
    ctx: SplitContext,
    rollIds: string[] | undefined,
    reason: string | undefined,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const colorStep = ctx.colorStep!; // allowedModes REDYE içerdiyse colorStep var
    const selected = this.resolveEligibleSelection(ctx, rollIds);
    const selectedIds = selected.map((r) => r.id);
    const sourceStepIds = [...new Set(selected.map((r) => r.currentStepId).filter((x): x is string => !!x))];

    const { newBatch, sourceDeleted } = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1) ATOMİK CLAIM: seçilenleri boyahane adımına geri sar (renk sıfırla).
        //    Çuval/sevk guard'ı where'de → arada paketlenirse count uyuşmaz → 409.
        const claim = await tx.roll.updateMany({
          where: {
            id: { in: selectedIds },
            batchId: ctx.batchId,
            status: { in: REDYE_ELIGIBLE_STATUSES },
            sackId: null,
            shipmentId: null,
          },
          data: {
            status: RollStatus.IN_PRODUCTION,
            currentStepId: colorStep.id,
            producedInStepId: colorStep.id,
            colorId: null,
          },
        });
        if (claim.count !== selectedIds.length) {
          throw AppError.conflict("Parti bu sırada değişti — yeniden boyama iptal, sayfayı yenileyin.");
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

        // 4) Açık RollError'ları NO_CUT ile kapat (yeniden boyanan kumaşta hata
        //    sayacı kalıcı şişmesin — M-13 semantiği).
        await tx.rollError.updateMany({
          where: { rollId: { in: selectedIds }, isProcessed: false },
          data: { isProcessed: true, actionTaken: "NO_CUT", processedAtStepId: null, processedAt: new Date() },
        });

        // 5) Etkilenen adımları recompute + WO'yu üretime çek (gerekirse geri aç).
        const affected = [...new Set<string>([colorStep.id, ...sourceStepIds])];
        for (const sid of affected) await recomputeStepStatus(tx, sid);
        await ensureWorkOrderInProgress(tx, ctx.workOrderId);
        // Depo-tebdili: WO tümüyle tamamlanmış olabilir (tüm toplar depodaydı) — geri aç.
        const reopened = await tx.workOrder.updateMany({
          where: { id: ctx.workOrderId, status: WorkOrderStatus.COMPLETED },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
        if (reopened.count > 0) {
          await setWorkOrderCardStatuses(tx, ctx.workOrderId, TravelerCardStatus.COMPLETED, TravelerCardStatus.ACTIVE);
        }

        // 6) Kaynak parti boşaldıysa (izsiz) sil.
        const sourceDeleted = await deleteIfEmptyAndTraceless(tx, ctx.batchId);

        return { newBatch: created.batch, sourceDeleted };
      }),
    );

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
        reason: reason ?? null,
      },
    });

    return {
      success: true,
      data: { newBatchId: newBatch.id, newBatchNumber: newBatch.batchNumber, sourceDeleted },
      message: `Yeni parti ${newBatch.batchNumber}: ${selectedIds.length} top boyahane adımına geri sarıldı — şimdi FASON SEVK ile boyahaneye gönderin, dönünce Fason Kabul ile alın.`,
    };
  }

  /**
   * NEW_COLOR: seçilen uygun toplar YENİ bir iş emrine (kaynağın birebir rotası,
   * hedef renk = newColorId) taşınır ve o WO'nun boyahane adımına geri sarılır
   * (renk sıfırlanır; kabulde YENİ renk uygulanır). Yeni WO + yeni parti + yeni kart.
   */
  private async newColorRedye(
    ctx: SplitContext,
    newColorId: string,
    orderMode: "stock" | "keep",
    rollIds: string[] | undefined,
    reason: string | undefined,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const colorStep = ctx.colorStep!;
    const color = await prisma.color.findUnique({ where: { id: newColorId }, select: { id: true, isActive: true } });
    if (!color || !color.isActive) throw AppError.badRequest("Yeni renk bulunamadı veya pasif.");

    const selected = this.resolveEligibleSelection(ctx, rollIds);
    const selectedIds = selected.map((r) => r.id);
    const sourceStepIds = [...new Set(selected.map((r) => r.currentStepId).filter((x): x is string => !!x))];
    const movedTotalQty = selected.reduce((s, r) => s + Number(r.currentQty), 0);

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1) ATOMİK CLAIM: renk sıfırla + IN_PRODUCTION (adım klondan sonra atanır).
        const claim = await tx.roll.updateMany({
          where: {
            id: { in: selectedIds },
            batchId: ctx.batchId,
            status: { in: REDYE_ELIGIBLE_STATUSES },
            sackId: null,
            shipmentId: null,
          },
          data: { status: RollStatus.IN_PRODUCTION, colorId: null },
        });
        if (claim.count !== selectedIds.length) {
          throw AppError.conflict("Parti bu sırada değişti — ayırma iptal, sayfayı yenileyin.");
        }

        // 2) Yeni WO (kaynağın rotası, hedef renk = yeni renk) + kart.
        const { newWo, oldToNew, newReEntryStepId } = await cloneWorkOrderTx(tx, {
          sourceWorkOrderId: ctx.workOrderId,
          reEntryStepSequence: colorStep.stepSequence,
          targetColorId: newColorId,
          orderMode,
          movedTotalQty,
          userId,
        });

        // 3) Partinin ayak izini yeni WO adımlarına repoint (movement dahil — R1).
        await repointRollsTx(tx, selectedIds, oldToNew);

        // 4) Yeni WO boyahane adımına geri sar: açık movement kapat + taze aç.
        await tx.rollMovement.updateMany({
          where: { rollId: { in: selectedIds }, exitedAt: null },
          data: { exitedAt: new Date(), notes: "REDYE_REWIND" },
        });
        await tx.rollMovement.createMany({
          data: selected.map((r) => ({
            rollId: r.id,
            workOrderStepId: newReEntryStepId,
            qtyIn: r.currentQty,
            weightIn: r.weightKg ?? null,
            operatorId: userId ?? null,
            notes: "REDYE_REWIND_IN",
          })),
        });
        await tx.roll.updateMany({
          where: { id: { in: selectedIds } },
          data: { currentStepId: newReEntryStepId, producedInStepId: newReEntryStepId, status: RollStatus.IN_PRODUCTION },
        });

        // 5) Yeni WO'da yeni parti (splitFrom=kaynak parti).
        const created = await createBatchTx(tx, {
          workOrderId: newWo.id,
          rollIds: selectedIds,
          splitFromId: ctx.batchId,
          userId,
        });

        // 6) Açık RollError NO_CUT.
        await tx.rollError.updateMany({
          where: { rollId: { in: selectedIds }, isProcessed: false },
          data: { isProcessed: true, actionTaken: "NO_CUT", processedAtStepId: null, processedAt: new Date() },
        });

        // 7) Kaynak WO: partinin ÇIKTIĞI adımları + yeni reEntry recompute.
        for (const sid of sourceStepIds) await recomputeStepStatus(tx, sid);
        await recomputeStepStatus(tx, newReEntryStepId);

        // 8) Kaynak parti boşaldıysa (izsiz) sil.
        const sourceDeleted = await deleteIfEmptyAndTraceless(tx, ctx.batchId);

        // 9) Kaynak WO tümüyle boşaldıysa (tam-parti ayırma) iptal et (B1 — zombi WO).
        const sourceWorkOrderCancelled = await this.supersedeEmptiedSourceWorkOrderTx(tx, ctx.workOrderId);

        return { newWo, newBatch: created.batch, sourceDeleted, sourceWorkOrderCancelled };
      }),
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: ctx.workOrderId,
      newData: {
        event: "SPLIT_SOURCE",
        mode: "NEW_COLOR",
        batchId: ctx.batchId,
        newWorkOrderId: result.newWo.id,
        movedRollCount: selectedIds.length,
        newColorId,
        reason: reason ?? null,
        sourceWorkOrderCancelled: result.sourceWorkOrderCancelled,
      },
    });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: result.newWo.id,
      newData: {
        event: "SPLIT_TARGET",
        mode: "NEW_COLOR",
        sourceWorkOrderId: ctx.workOrderId,
        newBatchNumber: result.newBatch.batchNumber,
        movedRollCount: selectedIds.length,
        targetColorId: newColorId,
        orderMode,
      },
    });

    return {
      success: true,
      data: {
        newWorkOrderId: result.newWo.id,
        newWorkOrderNumber: result.newWo.workOrderNumber,
        newBatchId: result.newBatch.id,
        newBatchNumber: result.newBatch.batchNumber,
        movedRollCount: selectedIds.length,
        sourceBatchDeleted: result.sourceDeleted,
      },
      message: `Yeni iş emri ${result.newWo.workOrderNumber} oluşturuldu: ${selectedIds.length} top yeni parti ${result.newBatch.batchNumber} ile boyahane adımına geri sarıldı (renk sıfırlandı). YENİ refakat kartını basıp toplara takın, FASON SEVK ile gönderin; dönünce Fason Kabul ile alın — yeni renk kabulde uygulanır.`,
    };
  }

  /**
   * UNDYED_MOVE: partinin TÜM topları hâlâ fasonda (boyanmamış) → YENİ iş emrine
   * taşınır. Parti + açık fason sevki bütünüyle yeni WO'ya bağlanır (dispatch.batchId
   * 1:1 — K10); toplar AT_SUBCONTRACTOR kalır, kabul yeni WO'da yapılır. Kısmi seçim
   * YOK (açık sevk bölünemez — önce K8 "Düzelt" ile partiyi bölün).
   */
  private async undyedMove(
    ctx: SplitContext,
    orderMode: "stock" | "keep",
    rollIds: string[] | undefined,
    reason: string | undefined,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const atSubStep = ctx.atSubStep!; // allowedModes UNDYED içerdiyse atSubStep var
    const selected = ctx.rolls.filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR);
    const selectedIds = selected.map((r) => r.id);
    if (selectedIds.length === 0) throw AppError.badRequest("Taşınacak fason topu yok.");
    if (
      rollIds &&
      rollIds.length > 0 &&
      (rollIds.length !== selectedIds.length || !selectedIds.every((id) => rollIds.includes(id)))
    ) {
      throw AppError.badRequest(
        "Boyanmadan taşımada partinin TÜM topları taşınır — kısmi seçim için önce partiyi bölün (Düzelt).",
      );
    }
    const movedTotalQty = selected.reduce((s, r) => s + Number(r.currentQty), 0);

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // KAYNAK WO KİLİDİ (kilit tazeliği simetrisi): dispatch/receive/K8 araçları
        // (moveRolls/splitBatch/mergeBatches) aynı WO satırını kilitler — aşağıdaki
        // açık-sevk okuması + parti/sevk taşıma onlarla serileşsin (eşzamanlı
        // dispatch/merge'in commit'i görülsün). Yeni WO satırı zaten bu tx İÇİNDE
        // doğuyor (cloneWorkOrderTx) — onun için ayrıca kilit gerekmez.
        await touchWorkOrderTx(tx, ctx.workOrderId);
        // stepId scope + outstanding koşulu ŞART (K15 retarget başka adımların
        // dönmüş sevklerini partiye taşıyabilir — findFirst rastgele tarihçe sevki
        // seçmesin): taşınacak sevk, TAM bu fason adımının hâlâ dönmemiş kalemi
        // olan açık sevkidir; en güncel açık sevk seçilir (dispatchedAt desc).
        const openDispatch = await tx.subcontractorDispatch.findFirst({
          where: {
            batchId: ctx.batchId,
            stepId: atSubStep.id,
            cancelledAt: null,
            directShippedAt: null,
            items: { some: { remainderClosedAt: null, receiptItems: { none: { isPartial: false, receipt: { cancelledAt: null } } } } },
          },
          select: { id: true, dispatchNo: true },
          orderBy: { dispatchedAt: "desc" },
        });
        if (!openDispatch) throw AppError.conflict("Bu partinin açık fason sevki yok — taşıma yapılamaz.");

        const src = await tx.workOrder.findUnique({
          where: { id: ctx.workOrderId },
          select: { targetColorId: true },
        });

        // 1) Yeni WO (kaynağın rotası, aynı hedef renk) + kart. reEntry = fason adımı.
        const { newWo, oldToNew, newReEntryStepId } = await cloneWorkOrderTx(tx, {
          sourceWorkOrderId: ctx.workOrderId,
          reEntryStepSequence: atSubStep.stepSequence,
          targetColorId: src?.targetColorId ?? null,
          orderMode,
          movedTotalQty,
          userId,
        });

        // 2) ATOMİK CLAIM: topları yeni WO'nun fason adımına taşı (AT_SUBCONTRACTOR kalır).
        const claim = await tx.roll.updateMany({
          where: {
            id: { in: selectedIds },
            batchId: ctx.batchId,
            status: RollStatus.AT_SUBCONTRACTOR,
            currentStepId: atSubStep.id,
          },
          data: { currentStepId: newReEntryStepId },
        });
        if (claim.count !== selectedIds.length) {
          throw AppError.conflict("Parti bu sırada değişti — taşıma iptal, sayfayı yenileyin.");
        }

        // 3) Ayak izini repoint (açık fason movement'i yeni adıma taşınır, AÇIK kalır).
        await repointRollsTx(tx, selectedIds, oldToNew);

        // 4) Parti + açık sevk bütünüyle yeni WO'ya (batchId değişmez → receive F74 tutarlı).
        await tx.batch.update({ where: { id: ctx.batchId }, data: { workOrderId: newWo.id } });
        await tx.subcontractorDispatch.update({
          where: { id: openDispatch.id },
          data: { workOrderId: newWo.id, stepId: newReEntryStepId },
        });

        // 5) Kaynak WO'da boşalan fason adımı + yeni reEntry recompute.
        await recomputeStepStatus(tx, atSubStep.id);
        await recomputeStepStatus(tx, newReEntryStepId);

        // 6) Kaynak WO tümüyle boşaldıysa (tüm parti taşındı) iptal et (B1 — zombi WO).
        const sourceWorkOrderCancelled = await this.supersedeEmptiedSourceWorkOrderTx(tx, ctx.workOrderId);

        return { newWo, dispatchNo: openDispatch.dispatchNo, sourceWorkOrderCancelled };
      }),
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: ctx.workOrderId,
      newData: {
        event: "SPLIT_SOURCE",
        mode: "UNDYED_MOVE",
        batchId: ctx.batchId,
        newWorkOrderId: result.newWo.id,
        movedRollCount: selectedIds.length,
        reason: reason ?? null,
        sourceWorkOrderCancelled: result.sourceWorkOrderCancelled,
      },
    });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: result.newWo.id,
      newData: {
        event: "SPLIT_TARGET",
        mode: "UNDYED_MOVE",
        sourceWorkOrderId: ctx.workOrderId,
        movedBatchNumber: ctx.batchNumber,
        movedRollCount: selectedIds.length,
        orderMode,
      },
    });

    return {
      success: true,
      data: {
        newWorkOrderId: result.newWo.id,
        newWorkOrderNumber: result.newWo.workOrderNumber,
        movedBatchId: ctx.batchId,
        movedBatchNumber: ctx.batchNumber,
        movedRollCount: selectedIds.length,
        dispatchNo: result.dispatchNo,
      },
      message: `Yeni iş emri ${result.newWo.workOrderNumber} oluşturuldu: ${selectedIds.length} top (parti ${ctx.batchNumber}) hâlâ boyahanede, artık yeni iş emrine bağlı. Dönünce Fason Kabul'ü ${result.newWo.workOrderNumber} altında yapın — eski refakat kartı okutulunca ayrılan parti listede görünür.`,
    };
  }
}
