// =============================================================================
// TeksERP - Tambur Service
// =============================================================================
// Handles final quality decisions, roll splitting, and order allocation.
//
// CRITICAL BUSINESS RULES:
//   - Kurşun'da tespit edilen hatalar Tambur'da karar verme noktasına gelir.
//   - "KES" kararı verildiğinde mevcut topun metrajı azaltılmaz!
//     Yeni bir Roll kaydı (yeni barkod) oluşturulur → SCRAP veya A1.
//   - Orijinal topun currentQty'si net değere güncellenir → status PRODUCED.
//   - Net ürün Tambur'dan çıktıktan sonra sipariş tahsisi yapılabilir.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Prisma,
  Roll,
  RollStatus,
  RollError,
  RollOperationType,
  StationKind,
  Swatch,
} from "@prisma/client";
import { v4 as uuidv4 } from "uuid";
import { buildPrefixedBarcode, buildPrefixedCardNumber } from "../utils/barcode";
import { recomputeStepStatus } from "./helpers/roll-step.helper";

/** Generate a barcode for a split-off roll */
function generateSplitBarcode(originalBarcode: string): string {
  const suffix = uuidv4().replace(/-/g, "").substring(0, 6).toUpperCase();
  return `${originalBarcode}-KS-${suffix}`;
}

interface ErrorDecision {
  errorId: string;
  decision: "CUT" | "NO_CUT";
  qualityGrade?: string; // "FIRE", "A1" etc. Only relevant for CUT
}

/** Cut strategy: operator either cuts only at reported defects, or at a fixed meter interval. */
type CutMode = "BY_DEFECT" | "FIXED_LENGTH";

interface TamburRollSummary {
  rollId: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  errorCount: number;
  errors: Array<{
    id: string;
    startMeter: number;
    endMeter: number;
    errorType: string | null;
  }>;
}

interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: TamburRollSummary[];
}

export class TamburService {
  /**
   * Get rolls pending at Tambur station with their unprocessed errors.
   */
  async getPendingRolls(): Promise<ApiResponse<Roll[]>> {
    const rolls = await prisma.roll.findMany({
      where: {
        status: RollStatus.IN_PRODUCTION,
        errors: {
          some: { isProcessed: false },
        },
      },
      include: {
        item: true,
        variant: true,
        errors: {
          where: { isProcessed: false },
          orderBy: { startMeter: "asc" },
        },
      },
    });

    return { success: true, data: rolls };
  }

  /**
   * Get a single roll with its unprocessed errors for Tambur decision screen.
   */
  async getRollForDecision(rollId: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        item: true,
        variant: true,
        errors: {
          where: { isProcessed: false },
          orderBy: { startMeter: "asc" },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Refakat kartı barkoduyla TAMBUR adımını çöz ve o adımda şu an bekleyen
   * rolleri (stok kodu, lot/varyant kodu, en, hata özeti ile birlikte) döndür.
   *
   * Operatör tambur tabletine kartı okutur, bu metot hangi iş emrinin Tambur
   * adımında olduğumuzu ve işlenecek kumaşların listesini verir.
   */
  async getByCardBarcode(
    cardBarcode: string
  ): Promise<ApiResponse<TamburStepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: cardBarcode },
      select: { id: true, status: true, workOrderId: true },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    }
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(
        `Bu refakat kartı aktif değil (durum: ${card.status})`
      );
    }

    const step = await prisma.workOrderStep.findFirst({
      where: {
        workOrderId: card.workOrderId,
        station: { kind: StationKind.TAMBUR },
      },
      include: {
        station: true,
        workOrder: { select: { batchNumber: true } },
      },
      orderBy: { stepSequence: "asc" },
    });
    if (!step) {
      throw AppError.notFound("Bu iş emrinde Tambur adımı tanımlı değil");
    }

    // Adıma girmiş ama henüz tamamlanmamış roller (RollMovement.exitedAt = null)
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: step.id, exitedAt: null },
      select: {
        roll: {
          include: {
            item: { select: { code: true, name: true } },
            variant: { select: { code: true, name: true } },
            errors: {
              where: { isProcessed: false },
              orderBy: { startMeter: "asc" },
              select: {
                id: true,
                startMeter: true,
                endMeter: true,
                errorType: true,
              },
            },
          },
        },
      },
    });

    const rolls: TamburRollSummary[] = openMovements.map((m) => ({
      rollId: m.roll.id,
      barcode: m.roll.barcode,
      itemCode: m.roll.item.code,
      itemName: m.roll.item.name,
      variantCode: m.roll.variant?.code ?? null,
      variantName: m.roll.variant?.name ?? null,
      currentQty: m.roll.currentQty,
      width: m.roll.width,
      qualityGrade: m.roll.qualityGrade,
      errorCount: m.roll.errors.length,
      errors: m.roll.errors,
    }));

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        workOrderId: step.workOrderId,
        batchNumber: step.workOrder.batchNumber,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        rolls,
      },
    };
  }

  /**
   * Finalize a roll at Tambur station.
   *
   * CRITICAL BUSINESS RULE (Roll Splitting):
   * - For each CUT decision, create a NEW Roll record (new barcode) for the cut piece.
   * - The new roll gets status SCRAP (or specified qualityGrade like A1).
   * - The original roll's currentQty is updated to the net value.
   * - The original roll's status becomes PRODUCED.
   */
  async finalize(
    data: {
      rollId: string;
      netCurrentQty: number;
      decisions: ErrorDecision[];
      foldType?: "2-KAT" | "4-KAT";
      layerCount?: number | null;
      cutMode?: CutMode | null;
      cutLengthM?: number | null;
    },
    userId?: string
  ): Promise<
    ApiResponse<{
      originalRoll: Roll;
      splitRolls: Roll[];
      processedErrors: number;
    }>
  > {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      include: { item: true },
    });

    if (!roll) {
      throw AppError.notFound("Top bulunamadı");
    }

    const splitRolls: Roll[] = [];
    let processedCount = 0;

    const updatedRoll = await prisma.$transaction(async (tx) => {
      // Process each error decision
      for (const decision of data.decisions) {
        const rollError = await tx.rollError.findUnique({
          where: { id: decision.errorId },
        });

        if (!rollError || rollError.rollId !== data.rollId) {
          continue; // Skip invalid errors
        }

        if (decision.decision === "CUT") {
          // CRITICAL: Create a NEW Roll for the cut piece
          const cutQty = rollError.endMeter - rollError.startMeter;
          const splitBarcode = generateSplitBarcode(roll.barcode);

          // A1 kesiği satılabilir stok → A1_STOCK
          // Diğerleri (FIRE/SCRAP) → SCRAP
          const grade = (decision.qualityGrade ?? "FIRE").toUpperCase();
          const isA1 = grade === "A1" || grade === "A1-2.KALITE" || grade === "2.KALITE";
          const splitStatus = isA1 ? RollStatus.A1_STOCK : RollStatus.SCRAP;

          const splitRoll = await tx.roll.create({
            data: {
              barcode: splitBarcode,
              itemId: roll.itemId,
              variantId: roll.variantId,
              width: roll.width,
              initialQty: cutQty,
              currentQty: cutQty,
              weightKg: null,
              status: splitStatus,
              qualityGrade: isA1 ? "A1" : (decision.qualityGrade ?? "FIRE"),
              producedInStepId: roll.producedInStepId,
              parentRollId: roll.id,
            },
          });

          splitRolls.push(splitRoll);

          // Log the new scrap/A1 roll creation
          await AuditService.log({
            userId,
            action: "CREATE",
            tableName: "ROLL",
            recordId: splitRoll.id,
            newData: {
              barcode: splitRoll.barcode,
              status: splitRoll.status,
              qualityGrade: splitRoll.qualityGrade,
              currentQty: splitRoll.currentQty,
              splitFromRollId: data.rollId,
              errorId: decision.errorId,
            },
          });
        }

        // Update the error record — lifecycle alanlarını doldur
        await tx.rollError.update({
          where: { id: decision.errorId },
          data: {
            isProcessed: true,
            actionTaken:
              decision.decision === "CUT"
                ? `CUT_FOR_${decision.qualityGrade ?? "SCRAP"}`
                : "KEPT_NO_CUT",
            processedAtStepId: roll.currentStepId,
            processedByUserId: userId ?? null,
            processedAt: new Date(),
          },
        });

        processedCount++;
      }

      // Tambur parametrelerini (kat, kesim tipi, kesim uzunluğu) step.stepData'ya yaz
      const hasStepData =
        data.foldType !== undefined ||
        data.layerCount != null ||
        data.cutMode != null ||
        data.cutLengthM != null;
      if (hasStepData && roll.currentStepId) {
        const step = await tx.workOrderStep.findUnique({
          where: { id: roll.currentStepId },
          select: { stepData: true },
        });
        const existing = (step?.stepData as Record<string, unknown> | null) ?? {};
        const merged: Record<string, unknown> = {
          ...existing,
          tamburDecidedAt: new Date().toISOString(),
        };
        if (data.foldType !== undefined) merged.foldType = data.foldType;
        if (data.layerCount != null) merged.layerCount = data.layerCount;
        if (data.cutMode != null) merged.cutMode = data.cutMode;
        if (data.cutLengthM != null) merged.cutLengthM = data.cutLengthM;

        await tx.workOrderStep.update({
          where: { id: roll.currentStepId },
          data: { stepData: merged as Prisma.InputJsonValue },
        });
      }

      // Tambur adımındaki açık RollMovement'i kapat + step rollup recompute
      // now sabitlenir: exitedAt ve TAMBUR_PROCESSED.createdAt aynı timestamp'i
      // paylaşır → history sıralamasında OPERATION doğru yere (çıkışla birlikte,
      // sonraki adım girişinden önce) gelir.
      const now = new Date();
      const oldStepId = roll.currentStepId;
      if (oldStepId) {
        await tx.rollMovement.updateMany({
          where: {
            rollId: data.rollId,
            workOrderStepId: oldStepId,
            exitedAt: null,
          },
          data: {
            exitedAt: now,
            qtyOut: data.netCurrentQty,
            weightOut: roll.weightKg,
            notes: `TAMBUR_FINALIZED`,
          },
        });
      }

      // Sonraki adımı (varsa) bul — normalde Paket/Tartı/Etiket olur.
      let nextStepId: string | null = null;
      if (oldStepId) {
        const currentStep = await tx.workOrderStep.findUnique({
          where: { id: oldStepId },
          select: { workOrderId: true, stepSequence: true },
        });
        if (currentStep) {
          const next = await tx.workOrderStep.findFirst({
            where: {
              workOrderId: currentStep.workOrderId,
              stepSequence: { gt: currentStep.stepSequence },
              status: { not: "SKIPPED" },
            },
            orderBy: { stepSequence: "asc" },
            select: { id: true },
          });
          nextStepId = next?.id ?? null;
        }
      }

      // Update the original roll — sonraki adım varsa oraya, yoksa PRODUCED'a al.
      const updated = await tx.roll.update({
        where: { id: data.rollId },
        data: {
          currentQty: data.netCurrentQty,
          status: nextStepId ? RollStatus.IN_PRODUCTION : RollStatus.PRODUCED,
          currentStepId: nextStepId,
        },
        include: { item: true },
      });

      // Sonraki adıma RollMovement aç ve step status'u recompute et
      if (nextStepId) {
        await tx.rollMovement.create({
          data: {
            rollId: data.rollId,
            workOrderStepId: nextStepId,
            qtyIn: data.netCurrentQty,
            weightIn: roll.weightKg,
            operatorId: userId ?? null,
            notes: "ENTERED_FROM_TAMBUR",
          },
        });
        await recomputeStepStatus(tx, nextStepId);
      }

      // Per-roll Tambur işlem log'u
      if (oldStepId) {
        await tx.rollOperation.upsert({
          where: {
            rollId_workOrderStepId_operationType: {
              rollId: data.rollId,
              workOrderStepId: oldStepId,
              operationType: RollOperationType.TAMBUR_PROCESSED,
            },
          },
          create: {
            rollId: data.rollId,
            workOrderStepId: oldStepId,
            operationType: RollOperationType.TAMBUR_PROCESSED,
            operatorId: userId ?? null,
            createdAt: now,
            metadata: {
              foldType: data.foldType ?? null,
              layerCount: data.layerCount ?? null,
              cutMode: data.cutMode ?? null,
              cutLengthM: data.cutLengthM ?? null,
              netCurrentQty: data.netCurrentQty,
              splitCount: splitRolls.length,
              processedErrors: processedCount,
            } as Prisma.InputJsonValue,
          },
          update: {},
        });

        await recomputeStepStatus(tx, oldStepId);
      }

      return updated;
    });

    // Audit the original roll update
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.rollId,
      oldData: {
        currentQty: roll.currentQty,
        status: roll.status,
      },
      newData: {
        currentQty: data.netCurrentQty,
        status: RollStatus.PRODUCED,
        splitRollCount: splitRolls.length,
      },
    });

    return {
      success: true,
      data: {
        originalRoll: updatedRoll,
        splitRolls,
        processedErrors: processedCount,
      },
      message: `Tambur tamamlandı. ${splitRolls.length} kesim yapıldı, ${processedCount} hata işlendi.`,
    };
  }

  /**
   * Allocate a produced roll to an order line.
   * Business Rule: Roll must be in PRODUCED status with sufficient currentQty.
   */
  async allocate(
    data: {
      rollId: string;
      orderLineId: string;
      allocatedQty: number;
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({ where: { id: data.rollId } });
    if (!roll) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (roll.status !== RollStatus.PRODUCED) {
      throw AppError.badRequest(
        `Top PRODUCED durumunda değil (mevcut: ${roll.status}). Tahsis yapılamaz.`
      );
    }

    // Check existing allocations for this roll
    const existingAllocations = await prisma.orderAllocation.findMany({
      where: { rollId: data.rollId },
    });

    const totalAllocated = existingAllocations.reduce(
      (sum, a) => sum + a.allocatedQty,
      0
    );

    if (totalAllocated + data.allocatedQty > roll.currentQty) {
      throw AppError.badRequest(
        `Yetersiz miktar. Kalan: ${roll.currentQty - totalAllocated}m, İstenen: ${data.allocatedQty}m`
      );
    }

    // Verify order line exists
    const orderLine = await prisma.orderLine.findUnique({
      where: { id: data.orderLineId },
      include: { order: { include: { customer: true } } },
    });

    if (!orderLine) {
      throw AppError.notFound("Sipariş kalemi bulunamadı");
    }

    const allocation = await prisma.orderAllocation.create({
      data: {
        rollId: data.rollId,
        orderLineId: data.orderLineId,
        allocatedQty: data.allocatedQty,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ORDER_ALLOCATION",
      recordId: allocation.id,
      newData: {
        rollId: data.rollId,
        orderLineId: data.orderLineId,
        allocatedQty: data.allocatedQty,
        customerName: orderLine.order.customer.name,
      },
    });

    return {
      success: true,
      data: {
        allocationId: allocation.id,
        rollBarcode: roll.barcode,
        orderNumber: orderLine.order.orderNumber,
        customerName: orderLine.order.customer.name,
        allocatedQty: data.allocatedQty,
      },
      message: `${data.allocatedQty}m ${orderLine.order.customer.name} siparişine tahsis edildi`,
    };
  }

  // ===========================================================================
  // SPLIT ALLOCATE — Tek çağrıda N sipariş + stok paylaştırması
  // ===========================================================================
  /**
   * PRODUCED / A1_STOCK durumundaki bir rolü birden çok sipariş satırı ve/veya
   * stok hedefine paylaştırır. Stok hedefi için allocation oluşturulmaz —
   * kalan miktar rollede kalır.
   */
  async splitAllocate(
    data: {
      rollId: string;
      allocations: Array<{
        orderLineId?: string | null;
        targetStock?: boolean;
        qty: number;
      }>;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.allocations || data.allocations.length === 0) {
      throw AppError.badRequest("En az bir paylaştırma satırı girin");
    }

    for (const a of data.allocations) {
      if (a.qty <= 0) {
        throw AppError.badRequest("Paylaştırma miktarı pozitif olmalı");
      }
      if (!a.targetStock && !a.orderLineId) {
        throw AppError.badRequest(
          "Her satırda sipariş kalemi seçilmeli veya 'Stok' işaretlenmeli"
        );
      }
      if (a.targetStock && a.orderLineId) {
        throw AppError.badRequest(
          "Bir satır aynı anda hem stok hem sipariş olamaz"
        );
      }
    }

    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      include: { allocations: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (
      roll.status !== RollStatus.PRODUCED &&
      roll.status !== RollStatus.A1_STOCK
    ) {
      throw AppError.badRequest(
        `Bu top paylaştırmaya uygun değil (status: ${roll.status}). PRODUCED veya A1_STOCK olmalı.`
      );
    }

    const existingAllocated = roll.allocations.reduce((s, a) => s + a.allocatedQty, 0);
    const remaining = roll.currentQty - existingAllocated;
    const requestedTotal = data.allocations.reduce((s, a) => s + a.qty, 0);

    if (requestedTotal > remaining + 1e-6) {
      throw AppError.badRequest(
        `Toplam paylaştırma (${requestedTotal.toFixed(1)}m) kalan metrajı (${remaining.toFixed(1)}m) aşıyor`
      );
    }

    // OrderLine'ların varlığını doğrula
    const orderLineIds = data.allocations
      .filter((a) => a.orderLineId)
      .map((a) => a.orderLineId as string);
    const orderLines = await prisma.orderLine.findMany({
      where: { id: { in: orderLineIds } },
      include: { order: { include: { customer: true } } },
    });
    if (orderLines.length !== new Set(orderLineIds).size) {
      throw AppError.notFound("Bir veya birden çok sipariş kalemi bulunamadı");
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdAllocations = [];
      for (const a of data.allocations) {
        if (a.targetStock) {
          continue; // Stok tarafı için allocation yok
        }
        const alloc = await tx.orderAllocation.create({
          data: {
            rollId: data.rollId,
            orderLineId: a.orderLineId as string,
            allocatedQty: a.qty,
          },
        });
        createdAllocations.push(alloc);
      }
      return { createdAllocations };
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ORDER_ALLOCATION",
      recordId: data.rollId,
      newData: {
        rollBarcode: roll.barcode,
        splits: data.allocations,
        createdCount: result.createdAllocations.length,
      },
    });

    return {
      success: true,
      data: {
        rollBarcode: roll.barcode,
        allocations: result.createdAllocations,
        splits: data.allocations,
      },
      message: `${result.createdAllocations.length} sipariş tahsisi, ${data.allocations.filter((a) => a.targetStock).length} stok dilimi kaydedildi`,
    };
  }

  // ===========================================================================
  // SWATCH — Kartela üretimi
  // ===========================================================================
  /**
   * Kaynak rolden uzunluk*adet kadar metraj düşerek `count` adet kartela üretir.
   * Her kartela kendi barkodunu (SW-YYMM-XXXXXX-C) ve kart numarasını alır.
   */
  async createSwatch(
    data: {
      sourceRollId: string;
      length: number; // metre
      width?: number | null;
      count: number; // adet
      purpose?: string | null;
      workOrderId?: string | null;
      variantId?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<Swatch[]>> {
    if (data.length <= 0) throw AppError.badRequest("Uzunluk pozitif olmalı");
    if (data.count <= 0) throw AppError.badRequest("Adet pozitif olmalı");
    if (!Number.isInteger(data.count)) {
      throw AppError.badRequest("Adet tam sayı olmalı");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: data.sourceRollId },
      include: { item: true, allocations: true },
    });
    if (!roll) throw AppError.notFound("Kaynak top bulunamadı");

    const totalDeduct = data.length * data.count;
    const existingAllocated = roll.allocations.reduce((s, a) => s + a.allocatedQty, 0);
    const remaining = roll.currentQty - existingAllocated;
    if (totalDeduct > remaining + 1e-6) {
      throw AppError.badRequest(
        `Kartela için yeterli metraj yok. Kalan: ${remaining.toFixed(1)}m, Gereken: ${totalDeduct.toFixed(1)}m`
      );
    }

    const created: Swatch[] = await prisma.$transaction(async (tx) => {
      const list: Swatch[] = [];
      for (let i = 0; i < data.count; i++) {
        const seq = await this.nextSwatchSequence(tx);
        const now = new Date();
        const cardNumber = buildPrefixedCardNumber("SW", now, seq, 6);
        const barcode = buildPrefixedBarcode("SW", now, seq);

        const sw = await tx.swatch.create({
          data: {
            cardNumber,
            barcode,
            itemId: roll.itemId,
            variantId: data.variantId ?? roll.variantId ?? null,
            width: data.width ?? roll.width ?? null,
            length: data.length,
            workOrderId: data.workOrderId ?? null,
            parentRollId: roll.id,
            purpose: data.purpose ?? null,
            createdById: userId ?? null,
          },
        });
        list.push(sw);
      }

      // Kaynak rolden düş
      await tx.roll.update({
        where: { id: roll.id },
        data: { currentQty: roll.currentQty - totalDeduct },
      });

      return list;
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SWATCH",
      recordId: roll.id,
      newData: {
        rollBarcode: roll.barcode,
        swatchCount: created.length,
        length: data.length,
        totalDeductedMeters: totalDeduct,
      },
    });

    return {
      success: true,
      data: created,
      message: `${created.length} adet kartela üretildi (${totalDeduct.toFixed(1)}m düşüldü)`,
    };
  }

  async listSwatches(params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
  }): Promise<ApiResponse<Swatch[]>> {
    const where: Prisma.SwatchWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.itemId) where.itemId = params.itemId;

    const swatches = await prisma.swatch.findMany({
      where,
      include: {
        item: true,
        variant: true,
        workOrder: true,
        parentRoll: true,
      },
      orderBy: { createdAt: "desc" },
      take: params?.limit ?? 100,
    });
    return { success: true, data: swatches };
  }

  private async nextSwatchSequence(tx: Prisma.TransactionClient): Promise<number> {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `SW-${yy}${mm}-`;
    const last = await tx.swatch.findFirst({
      where: { barcode: { startsWith: prefix } },
      orderBy: { barcode: "desc" },
      select: { barcode: true },
    });
    if (!last) return 1;
    const parts = last.barcode.split("-");
    if (parts.length < 4) return 1;
    const seqStr = parts[2];
    const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let n = 0;
    for (const ch of seqStr.toUpperCase()) {
      const v = CROCKFORD.indexOf(ch);
      if (v < 0) return 1;
      n = n * 32 + v;
    }
    return n + 1;
  }
}
