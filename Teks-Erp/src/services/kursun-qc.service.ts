// =============================================================================
// TeksERP - Kurşun + Kalite Kontrol 2 (PROCESS_QC) Service
// =============================================================================
// Kurşun ve Kalite Kontrol 2 tek fiziksel istasyon, tek WorkOrderStep.
// Her TOP (roll) için bağımsız iki işlem log'u tutulur:
//   - KURSUN_APPLIED : bu topa kurşun geçildi (opsiyonel — bazı toplar almayabilir)
//   - QC2_COMPLETED  : bu topun kalite kontrolü bitti
//
// Hata tespiti (RollError) bu istasyonda açılır, Tambur'da karara bağlanır.
// Tespitte `detectedAtStepId` + `detectedByUserId` + `detectedAt` doldurulur.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  Prisma,
  RollError,
  RollOperation,
  RollOperationType,
  StationKind,
} from "@prisma/client";

interface RollDefectSummary {
  id: string;
  startMeter: number;
  endMeter: number;
  defectTypeId: string | null;
  errorType: string | null; // snapshot'lanmış ad (DefectType.name)
}

interface RollSummary {
  rollId: string;
  barcode: string;
  currentQty: number;
  kursunApplied: boolean;
  qc2Completed: boolean;
  errorCount: number;
  defects: RollDefectSummary[];
}

interface StepSummary {
  workOrderStepId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  rolls: RollSummary[];
}

export class KursunQcService {
  // ---------------------------------------------------------------------------
  // LOOKUP
  // ---------------------------------------------------------------------------
  /**
   * Refakat kartı barkoduyla PROCESS_QC adımını ve bu adıma giren rolleri çöz.
   * Operatör tablette kartı okutur, bu metot hangi step'te olduğunu ve hangi
   * rollerin bu step'e girmiş olduğunu döner.
   */
  async getByCardBarcode(cardBarcode: string): Promise<ApiResponse<StepSummary>> {
    const card = await prisma.travelerCard.findUnique({
      where: { barcode: cardBarcode },
      select: {
        id: true,
        status: true,
        workOrderId: true,
      },
    });
    if (!card) {
      throw AppError.notFound(`Refakat kartı bulunamadı: ${cardBarcode}`);
    }
    if (card.status !== "ACTIVE") {
      throw AppError.badRequest(
        `Bu refakat kartı aktif değil (durum: ${card.status})`
      );
    }

    // İş emrindeki ilk PROCESS_QC adımı (tipik olarak tek tane olur).
    const step = await prisma.workOrderStep.findFirst({
      where: {
        workOrderId: card.workOrderId,
        station: { kind: StationKind.PROCESS_QC },
      },
      include: {
        station: true,
        workOrder: { select: { batchNumber: true } },
      },
      orderBy: { stepSequence: "asc" },
    });
    if (!step) {
      throw AppError.notFound(
        "Bu iş emrinde Kurşun + QC2 adımı tanımlı değil"
      );
    }

    return this.buildStepSummary(step.id);
  }

  /** Step ID ile doğrudan çek (admin/test ekranları). */
  async getStep(stepId: string): Promise<ApiResponse<StepSummary>> {
    return this.buildStepSummary(stepId);
  }

  // ---------------------------------------------------------------------------
  // PER-ROLL ACTIONS
  // ---------------------------------------------------------------------------
  /**
   * Bir topa "Kurşun geçildi" işlemini kaydet. Aynı top için idempotent:
   * ikinci çağrıda mevcut kaydı döner, hata atmaz.
   */
  async applyKursun(
    data: { rollId: string; stepId: string; notes?: string | null },
    userId?: string
  ): Promise<ApiResponse<RollOperation>> {
    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    const op = await prisma.rollOperation.upsert({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.KURSUN_APPLIED,
        },
      },
      create: {
        rollId: data.rollId,
        workOrderStepId: data.stepId,
        operationType: RollOperationType.KURSUN_APPLIED,
        operatorId: userId ?? null,
        metadata: data.notes ? { notes: data.notes } : undefined,
      },
      update: {}, // idempotent
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_OPERATION",
      recordId: op.id,
      newData: {
        rollId: data.rollId,
        stepId: data.stepId,
        type: RollOperationType.KURSUN_APPLIED,
      },
    });

    return { success: true, data: op, message: "Kurşun geçildi olarak işaretlendi" };
  }

  /**
   * Kurşun işlemini geri al (yanlış işaretleme düzeltmesi).
   * QC2 tamamlandıysa kaldırılamaz — audit bütünlüğü için.
   */
  async undoKursun(
    data: { rollId: string; stepId: string },
    userId?: string
  ): Promise<ApiResponse<{ removed: boolean }>> {
    const qc2 = await prisma.rollOperation.findUnique({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
        },
      },
    });
    if (qc2) {
      throw AppError.badRequest(
        "Kalite Kontrol 2 tamamlandıktan sonra Kurşun işlemi geri alınamaz"
      );
    }

    const existing = await prisma.rollOperation.findUnique({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.KURSUN_APPLIED,
        },
      },
    });
    if (!existing) {
      return { success: true, data: { removed: false }, message: "Zaten işaretli değil" };
    }

    await prisma.rollOperation.delete({ where: { id: existing.id } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ROLL_OPERATION",
      recordId: existing.id,
      oldData: {
        rollId: data.rollId,
        stepId: data.stepId,
        type: RollOperationType.KURSUN_APPLIED,
      },
    });

    return { success: true, data: { removed: true }, message: "Kurşun işareti kaldırıldı" };
  }

  /**
   * Bir topun Kalite Kontrol 2 işlemini tamamla (per-roll).
   * Toplar teker teker `QC2_COMPLETED` işaretlenir; tüm roller bittiğinde
   * operatör `finishStep` çağrısıyla adımı kapatır.
   */
  async completeQc2(
    data: { rollId: string; stepId: string; notes?: string | null },
    userId?: string
  ): Promise<ApiResponse<RollOperation>> {
    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    const op = await prisma.rollOperation.upsert({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
        },
      },
      create: {
        rollId: data.rollId,
        workOrderStepId: data.stepId,
        operationType: RollOperationType.QC2_COMPLETED,
        operatorId: userId ?? null,
        metadata: data.notes ? { notes: data.notes } : undefined,
      },
      update: {},
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_OPERATION",
      recordId: op.id,
      newData: {
        rollId: data.rollId,
        stepId: data.stepId,
        type: RollOperationType.QC2_COMPLETED,
      },
    });

    return { success: true, data: op, message: "Kalite Kontrol 2 tamamlandı" };
  }

  // ---------------------------------------------------------------------------
  // DEFECT ENTRY
  // ---------------------------------------------------------------------------
  /**
   * Topta hata tespit et. RollError detectedAtStep/User/At ile kayıt açar.
   * Tambur'da karara bağlanır (isProcessed=true olana kadar pending).
   *
   * Hata tipi DefectType kataloğundan seçilir — serbest metin kabul edilmez.
   * Katalog ileride yeniden adlandırılsa bile historik etiket `errorType`
   * alanına snapshot olarak yazılır.
   */
  async reportError(
    data: {
      rollId: string;
      stepId: string;
      startMeter: number;
      endMeter: number;
      defectTypeId: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    const roll = await prisma.roll.findUnique({ where: { id: data.rollId } });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    if (data.startMeter >= data.endMeter) {
      throw AppError.badRequest(
        "Başlangıç metresi bitiş metresinden küçük olmalı"
      );
    }
    if (data.endMeter > roll.currentQty) {
      throw AppError.badRequest(
        `Bitiş metresi (${data.endMeter}) topun metrajını (${roll.currentQty}) aşıyor`
      );
    }

    const defectType = await prisma.defectType.findUnique({
      where: { id: data.defectTypeId },
    });
    if (!defectType) throw AppError.notFound("Hata tipi bulunamadı");
    if (!defectType.isActive) {
      throw AppError.badRequest(
        `Hata tipi pasif durumda (${defectType.name}) — aktif bir tip seçin`
      );
    }

    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    const err = await prisma.rollError.create({
      data: {
        rollId: data.rollId,
        startMeter: data.startMeter,
        endMeter: data.endMeter,
        defectTypeId: defectType.id,
        errorType: defectType.name, // snapshot — katalog rename olsa bile sabit kalır
        isProcessed: false,
        detectedAtStepId: data.stepId,
        detectedByUserId: userId ?? null,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_ERROR",
      recordId: err.id,
      newData: {
        rollId: data.rollId,
        stepId: data.stepId,
        startMeter: data.startMeter,
        endMeter: data.endMeter,
        defectTypeId: defectType.id,
        errorType: defectType.name,
      },
    });

    return {
      success: true,
      data: err,
      message: `${defectType.name} · ${data.startMeter}m–${data.endMeter}m`,
    };
  }

  /**
   * Hatalı tespit edilen kaydı sil (Tambur karar vermeden önce).
   */
  async deleteError(
    data: { errorId: string },
    userId?: string
  ): Promise<ApiResponse<{ deleted: true }>> {
    const err = await prisma.rollError.findUnique({ where: { id: data.errorId } });
    if (!err) throw AppError.notFound("Hata kaydı bulunamadı");
    if (err.isProcessed) {
      throw AppError.badRequest(
        "Tambur kararı verilmiş hata kaydı silinemez"
      );
    }

    await prisma.rollError.delete({ where: { id: data.errorId } });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ROLL_ERROR",
      recordId: data.errorId,
      oldData: {
        rollId: err.rollId,
        startMeter: err.startMeter,
        endMeter: err.endMeter,
        errorType: err.errorType,
      },
    });

    return { success: true, data: { deleted: true }, message: "Hata kaydı silindi" };
  }

  // ---------------------------------------------------------------------------
  // FINISH STEP (batch-level)
  // ---------------------------------------------------------------------------
  /**
   * Tüm topların QC2'si tamamlandıysa step'i kapatır:
   *   - Açık RollMovement'leri (exitedAt=null) kapatır
   *   - Her top bir sonraki adıma taşınır (openMovementForNextStep)
   *   - Step COMPLETED olarak işaretlenir
   *
   * Aşağıdaki durum hata döndürür:
   *   - QC2_COMPLETED olmayan en az bir aktif top varsa
   */
  async finishStep(
    data: { stepId: string },
    userId?: string
  ): Promise<ApiResponse<{ movedRollCount: number }>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        workOrder: {
          include: { steps: { orderBy: { stepSequence: "asc" } } },
        },
      },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest(
        "finishStep yalnızca PROCESS_QC adımları için çağrılabilir"
      );
    }

    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: step.id, exitedAt: null },
      select: { id: true, rollId: true, weightIn: true, qtyIn: true },
    });

    // Tüm açık rollerde QC2_COMPLETED olmalı
    const missingQc2: string[] = [];
    for (const m of openMovements) {
      const qc2 = await prisma.rollOperation.findUnique({
        where: {
          rollId_workOrderStepId_operationType: {
            rollId: m.rollId,
            workOrderStepId: step.id,
            operationType: RollOperationType.QC2_COMPLETED,
          },
        },
        select: { id: true },
      });
      if (!qc2) missingQc2.push(m.rollId);
    }
    if (missingQc2.length > 0) {
      throw AppError.badRequest(
        `Kalite Kontrol 2 tamamlanmamış ${missingQc2.length} top var. Tüm toplar bitmeden adım kapatılamaz.`
      );
    }

    const nextStep = step.workOrder.steps.find(
      (s) => s.stepSequence > step.stepSequence
    );

    // Lazily import helper to avoid circular (roll-step.helper → prisma)
    const { openMovementForNextStep, recomputeStepStatus } = await import(
      "./helpers/roll-step.helper"
    );

    const result = await prisma.$transaction(async (tx) => {
      let moved = 0;
      for (const m of openMovements) {
        // Kapat
        await tx.rollMovement.update({
          where: { id: m.id },
          data: {
            exitedAt: new Date(),
            qtyOut: m.qtyIn, // PROCESS_QC'de metraj değişmez
            weightOut: m.weightIn,
            notes: "QC2_STEP_FINISHED",
          },
        });

        if (nextStep) {
          await openMovementForNextStep(tx, {
            rollId: m.rollId,
            nextStepId: nextStep.id,
            qty: m.qtyIn,
            weight: m.weightIn ?? null,
            userId: userId ?? null,
          });
        } else {
          // Son adımdıysa current pointer'ı temizle
          await tx.roll.update({
            where: { id: m.rollId },
            data: { currentStepId: null },
          });
        }
        moved++;
      }

      await recomputeStepStatus(tx, step.id);
      return { moved };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      newData: {
        status: "COMPLETED_FROM_QC2",
        movedRollCount: result.moved,
        nextStepId: nextStep?.id ?? null,
      },
    });

    return {
      success: true,
      data: { movedRollCount: result.moved },
      message: `Adım kapatıldı, ${result.moved} top bir sonraki istasyona taşındı`,
    };
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------
  private async assertRollInStep(
    rollId: string,
    stepId: string,
    expectedKind: StationKind
  ): Promise<void> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, currentStepId: true, barcode: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.currentStepId !== stepId) {
      throw AppError.badRequest(
        `Top (${roll.barcode}) şu anda bu istasyonda değil`
      );
    }
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: { station: { select: { kind: true } } },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== expectedKind) {
      throw AppError.badRequest(
        `Bu adım ${expectedKind} tipinde değil (mevcut: ${step.station.kind})`
      );
    }
  }

  private async buildStepSummary(stepId: string): Promise<ApiResponse<StepSummary>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        workOrder: { select: { id: true, batchNumber: true } },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest(
        "Bu adım Kurşun + QC2 tipinde değil"
      );
    }

    // Adımda şu anda açık olan rollerin hareket kayıtları
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: stepId, exitedAt: null },
      select: {
        roll: { select: { id: true, barcode: true, currentQty: true } },
      },
    });

    const rollIds = openMovements.map((m) => m.roll.id);
    const [ops, errors] = await Promise.all([
      prisma.rollOperation.findMany({
        where: { workOrderStepId: stepId, rollId: { in: rollIds } },
        select: { rollId: true, operationType: true },
      }),
      prisma.rollError.findMany({
        where: { rollId: { in: rollIds }, detectedAtStepId: stepId },
        select: {
          id: true,
          rollId: true,
          startMeter: true,
          endMeter: true,
          defectTypeId: true,
          errorType: true,
        },
        orderBy: { startMeter: "asc" },
      }),
    ]);

    const opsByRoll = new Map<string, Set<RollOperationType>>();
    for (const o of ops) {
      if (!opsByRoll.has(o.rollId)) opsByRoll.set(o.rollId, new Set());
      opsByRoll.get(o.rollId)!.add(o.operationType);
    }
    const defectsByRoll = new Map<string, RollDefectSummary[]>();
    for (const e of errors) {
      if (!defectsByRoll.has(e.rollId)) defectsByRoll.set(e.rollId, []);
      defectsByRoll.get(e.rollId)!.push({
        id: e.id,
        startMeter: e.startMeter,
        endMeter: e.endMeter,
        defectTypeId: e.defectTypeId,
        errorType: e.errorType,
      });
    }

    const rolls: RollSummary[] = openMovements.map((m) => {
      const defects = defectsByRoll.get(m.roll.id) ?? [];
      return {
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        currentQty: m.roll.currentQty,
        kursunApplied:
          opsByRoll.get(m.roll.id)?.has(RollOperationType.KURSUN_APPLIED) ?? false,
        qc2Completed:
          opsByRoll.get(m.roll.id)?.has(RollOperationType.QC2_COMPLETED) ?? false,
        errorCount: defects.length,
        defects,
      };
    });

    return {
      success: true,
      data: {
        workOrderStepId: step.id,
        stationId: step.stationId,
        stationCode: step.station.code,
        stationName: step.station.name,
        workOrderId: step.workOrder.id,
        batchNumber: step.workOrder.batchNumber,
        rolls,
      },
    };
  }
}

// Satisfy strict unused-locals for import Prisma (type-only usage).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _PrismaKeep = Prisma.TransactionClient;
