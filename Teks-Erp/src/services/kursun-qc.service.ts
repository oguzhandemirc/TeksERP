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
  RollStatus,
  StationKind,
  StepStatus,
} from "@prisma/client";
import { assertWoAtStepKind } from "./helpers/roll-step.helper";

interface RollDefectSummary {
  id: string;
  startMeter: number;
  /// Bitiş metresi opsiyonel — operatör çoğunlukla sadece başlangıç metresi girer.
  endMeter: number | null;
  defectTypeId: string | null;
  errorType: string | null; // snapshot'lanmış ad (DefectType.name)
}

interface RollSummary {
  rollId: string;
  /// Açık kumaş Roll'larında NULL olabilir.
  barcode: string | null;
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
  status: StepStatus;
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

    // İş emrindeki PROCESS_QC step'ini doğrula. Multi-batch: WO'nun rulları
    // farklı adımlarda olabilir; helper bu durumda net mesaj döner.
    const { stepId } = await assertWoAtStepKind(
      card.workOrderId,
      StationKind.PROCESS_QC,
    );

    return this.buildStepSummary(stepId);
  }

  /** Step ID ile doğrudan çek (admin/test ekranları). */
  async getStep(stepId: string): Promise<ApiResponse<StepSummary>> {
    return this.buildStepSummary(stepId);
  }

  /**
   * Şu an PROCESS_QC istasyonlarında açık top bekleyen tüm aktif refakat kartları.
   * Mobil "kamera simülasyonu" modal'ı için — operatör fiziksel kart yokken
   * bu listeden seçim yapabilir.
   *
   * Filtre: station.kind = PROCESS_QC, step.status != COMPLETED, en az 1 açık top
   * (currentStepId = step.id), ve WO'nun ACTIVE refakat kartı mevcut.
   */
  async listOpenCards(): Promise<
    ApiResponse<
      Array<{
        cardId: string;
        cardNumber: string;
        cardBarcode: string;
        workOrderId: string;
        batchNumber: string;
        stepId: string;
        stationName: string;
        stationCode: string;
        openRollCount: number;
      }>
    >
  > {
    const steps = await prisma.workOrderStep.findMany({
      where: {
        station: { kind: StationKind.PROCESS_QC },
        status: { not: "COMPLETED" },
        currentRolls: { some: {} },
      },
      select: {
        id: true,
        workOrderId: true,
        station: { select: { name: true, code: true } },
        workOrder: {
          select: {
            batchNumber: true,
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { id: true, cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        _count: { select: { currentRolls: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const data = steps
      .map((s) => {
        const card = s.workOrder.travelerCards[0];
        if (!card) return null;
        return {
          cardId: card.id,
          cardNumber: card.cardNumber,
          cardBarcode: card.barcode,
          workOrderId: s.workOrderId,
          batchNumber: s.workOrder.batchNumber,
          stepId: s.id,
          stationName: s.station.name,
          stationCode: s.station.code,
          openRollCount: s._count.currentRolls,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { success: true, data };
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

  /**
   * Bir topun QC2_COMPLETED işaretini geri al — operatör yanlış işaretlediyse
   * veya reopen sonrası geriye almak isterse. Top hâlâ bu adımdaysa çalışır.
   */
  async undoQc2(
    data: { rollId: string; stepId: string },
    userId?: string
  ): Promise<ApiResponse<{ removed: boolean }>> {
    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    const existing = await prisma.rollOperation.findUnique({
      where: {
        rollId_workOrderStepId_operationType: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.QC2_COMPLETED,
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
        type: RollOperationType.QC2_COMPLETED,
      },
    });

    return { success: true, data: { removed: true }, message: "QC2 işareti kaldırıldı" };
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

    if (openMovements.length === 0) {
      throw AppError.badRequest("Bu adımda açık top yok; kapatılacak hareket bulunamadı.");
    }

    // Tüm açık rollerde QC2_COMPLETED olmalı — tek IN sorgusuyla kontrol et.
    // Tambur kalıtım kayıtları sayılmaz — sadece bu step'te fiilen yapılan QC2.
    const rollIds = openMovements.map((m) => m.rollId);
    const completedQc2 = await prisma.rollOperation.findMany({
      where: {
        workOrderStepId: step.id,
        operationType: RollOperationType.QC2_COMPLETED,
        rollId: { in: rollIds },
        inheritedFromParentRollId: null,
      },
      select: { rollId: true },
    });
    const completedSet = new Set(completedQc2.map((q) => q.rollId));
    const missingCount = rollIds.filter((id) => !completedSet.has(id)).length;
    if (missingCount > 0) {
      throw AppError.badRequest(
        `Kalite Kontrol 2 tamamlanmamış ${missingCount} top var. Tüm toplar bitmeden adım kapatılamaz.`
      );
    }

    const nextStep = step.workOrder.steps.find(
      (s) => s.stepSequence > step.stepSequence
    );

    // Lazily import helper to avoid circular (roll-step.helper → prisma)
    const { recomputeStepStatus } = await import("./helpers/roll-step.helper");

    const movementIds = openMovements.map((m) => m.id);
    const result = await prisma.$transaction(async (tx) => {
      // 1) Açık movement'leri toplu kapat — qty/weight per-row eşitlik raw SQL ile.
      await tx.$executeRaw`
        UPDATE "roll_movements"
        SET "qtyOut" = "qtyIn",
            "weightOut" = "weightIn",
            "exitedAt" = NOW(),
            "notes" = 'QC2_STEP_FINISHED'
        WHERE id = ANY(${movementIds}::text[])
      `;

      if (nextStep) {
        // 2a) Sonraki step için movement'leri toplu oluştur.
        await tx.rollMovement.createMany({
          data: openMovements.map((m) => ({
            rollId: m.rollId,
            workOrderStepId: nextStep.id,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn ?? null,
            operatorId: userId ?? null,
            notes: null,
          })),
        });
        // 3a) Roll currentStepId'leri toplu güncelle.
        await tx.roll.updateMany({
          where: { id: { in: rollIds } },
          data: { currentStepId: nextStep.id },
        });
        // 4a) Step durumlarını birer kez recompute et (per-roll değil).
        await recomputeStepStatus(tx, nextStep.id);
      } else {
        // 2b) Son adımdıysa current pointer'ı toplu temizle.
        await tx.roll.updateMany({
          where: { id: { in: rollIds } },
          data: { currentStepId: null },
        });
      }

      await recomputeStepStatus(tx, step.id);
      return { moved: openMovements.length };
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
  // REOPEN STEP (geliştirme aşaması — operatör yanlışlıkla kapatırsa)
  // ---------------------------------------------------------------------------
  /**
   * Daha önce `finishStep` ile kapatılmış bir PROCESS_QC adımını yeniden açar.
   *   - Bu adımda QC2_STEP_FINISHED notuyla kapatılmış movement'ler exitedAt=null'a döner
   *   - Bu hareketler için sonraki step'te oluşturulmuş açık movement'ler silinir
   *   - Roll.currentStepId geriye (bu step'e) çekilir
   *   - Her iki step için recomputeStepStatus çağrılır
   *
   * Güvenlik kontrolü: yalnızca roller hâlâ sonraki step'te bekliyor ve üretimdeyse
   * (IN_PRODUCTION) yapılır. İleri taşınmış veya status değişmişse hata döner —
   * admin müdahalesi gerekir.
   */
  async reopenStep(
    data: { stepId: string },
    userId?: string
  ): Promise<ApiResponse<{ reopenedRollCount: number }>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        workOrder: {
          select: {
            steps: {
              orderBy: { stepSequence: "asc" },
              select: { id: true, stepSequence: true },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest("Bu adım Kurşun + QC2 tipinde değil");
    }
    if (step.status !== StepStatus.COMPLETED) {
      throw AppError.badRequest(
        `Bu adım zaten kapalı değil (durum: ${step.status})`
      );
    }

    const nextStep = step.workOrder.steps.find(
      (s) => s.stepSequence > step.stepSequence
    );

    // finishStep notes='QC2_STEP_FINISHED' ile bu step'in açık hareketlerini kapatmıştı.
    // Bu sayede aynı step'in eski tarihli (önceki finishStep'lerden gelmiş) kapalı
    // hareketleri ile yenisini ayırt edebiliyoruz.
    const closedMovements = await prisma.rollMovement.findMany({
      where: {
        workOrderStepId: step.id,
        exitedAt: { not: null },
        notes: "QC2_STEP_FINISHED",
      },
      select: {
        id: true,
        rollId: true,
        roll: {
          select: { id: true, status: true, currentStepId: true, barcode: true },
        },
      },
    });

    if (closedMovements.length === 0) {
      throw AppError.badRequest(
        "Bu adımı yeniden açacak kapalı hareket yok"
      );
    }

    // Güvenlik: her top hâlâ sonraki adımda bekliyor olmalı, ileri gitmemiş olmalı.
    if (nextStep) {
      for (const cm of closedMovements) {
        if (cm.roll.currentStepId !== nextStep.id) {
          throw AppError.badRequest(
            `Top (${cm.roll.barcode}) sonraki adımdan ileri taşınmış — yeniden açılamaz`
          );
        }
        if (cm.roll.status !== RollStatus.IN_PRODUCTION) {
          throw AppError.badRequest(
            `Top (${cm.roll.barcode}) artık üretimde değil (${cm.roll.status}) — yeniden açılamaz`
          );
        }
      }
    }

    const { recomputeStepStatus } = await import("./helpers/roll-step.helper");
    const rollIds = closedMovements.map((m) => m.rollId);
    const movementIds = closedMovements.map((m) => m.id);

    await prisma.$transaction(async (tx) => {
      if (nextStep) {
        // Sonraki adımda finishStep'in oluşturduğu açık movement'leri sil
        await tx.rollMovement.deleteMany({
          where: {
            workOrderStepId: nextStep.id,
            exitedAt: null,
            rollId: { in: rollIds },
          },
        });
        // Roll.currentStepId'yi bu step'e geri al
        await tx.roll.updateMany({
          where: { id: { in: rollIds } },
          data: { currentStepId: step.id },
        });
      }

      // Bu step'in kapatılmış movement'lerini geri aç
      await tx.rollMovement.updateMany({
        where: { id: { in: movementIds } },
        data: { qtyOut: null, weightOut: null, exitedAt: null, notes: null },
      });

      // QC2_COMPLETED / KURSUN_APPLIED işaretleri korunur — operatör eski veriyi
      // görsün, üzerinde oynayabilsin. Sıfırlamak isterse per-roll `undoQc2` kullanır.

      // Step durumlarını güncelle
      await recomputeStepStatus(tx, step.id);
      if (nextStep) await recomputeStepStatus(tx, nextStep.id);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      newData: {
        status: "REOPENED_FROM_COMPLETED",
        reopenedRollCount: rollIds.length,
        prevStatus: StepStatus.COMPLETED,
      },
    });

    return {
      success: true,
      data: { reopenedRollCount: rollIds.length },
      message: `Adım yeniden açıldı — ${rollIds.length} top geri çekildi`,
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
      // Tambur kalıtım kayıtları sayılmaz — bu step'te fiilen yapılan op'lar.
      prisma.rollOperation.findMany({
        where: {
          workOrderStepId: stepId,
          rollId: { in: rollIds },
          inheritedFromParentRollId: null,
        },
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
        status: step.status,
        rolls,
      },
    };
  }
}

// Satisfy strict unused-locals for import Prisma (type-only usage).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _PrismaKeep = Prisma.TransactionClient;
