// =============================================================================
// TeksERP - Kurşun + Kalite Kontrol 2 (PROCESS_QC) Service
// =============================================================================
// Kurşun ve Kalite Kontrol 2 tek fiziksel istasyon, tek WorkOrderStep.
// Her TOP (roll) için QC2_COMPLETED log'u operatör tarafından yazılır.
//
// Kurşun yeteneği per-station tanımlanır: istasyonun propertyCapabilities
// listesinde FabricProperty(code='KURSUN') varsa, QC2 tamamlanan her top
// otomatik olarak KURSUN_APPLIED log'u + RollProperty(KURSUN) kazanır.
// Per-roll "kurşun geçtim/geçmedim" toggle'ı yoktur — istasyon yeteneği
// tek doğruluk kaynağıdır.
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
import { copyStationCapabilitiesToRoll } from "./helpers/station-capability-transfer.helper";

interface RollDefectSummary {
  id: string;
  /// Hata noktası (tek metre değeri). KK2/Kurşun operatörü "60. metrede hata"
  /// olarak girer; aralık bilgisi tutulmaz. Tambur operatörü ekranda görüp
  /// fiziksel kesim kararı verir.
  startMeter: number;
  defectTypeId: string | null;
  errorType: string | null; // snapshot'lanmış ad (DefectType.name)
}

interface RollSummary {
  rollId: string;
  /// Açık kumaş Roll'larında NULL olabilir.
  barcode: string | null;
  currentQty: number;
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
  /// İstasyona KURSUN özelliği yetenek olarak atanmış mı? Mobil UI'da
  /// "her top otomatik kurşunlanır" banner'ı için.
  appliesKursun: boolean;
  rolls: RollSummary[];
}

export interface KursunQueueItem {
  /// WorkOrderStep.id — reorder/urgent endpoint'leri bu id'yi alır.
  /// Tablet `open-cards` listesi ve Electron Kurşun Sırası ortak okur.
  workOrderStepId: string;
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  /// Refakat kartı (ACTIVE) numarası — bulunamazsa null.
  travelerCardNumber: string | null;
  travelerCardBarcode: string | null;
  /// Kumaş cinsi — WO.targetItem.name.
  itemName: string | null;
  /// Renk adı + hex — WO.targetColor.
  colorName: string | null;
  colorHex: string | null;
  /// PROCESS_QC adımı bekleyen açık top sayısı.
  openRollCount: number;
  /// Bekleyen toplarda kalan toplam metre.
  totalCurrentQty: number;
  /// İlk topun girişi (en eski) — UI'da bekleme süresi göstermek için.
  oldestEnteredAt: Date | null;
  priority: number;
  isUrgent: boolean;
  urgentMarkedAt: Date | null;
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
        priority: number;
        isUrgent: boolean;
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
        priority: true,
        isUrgent: true,
        urgentMarkedAt: true,
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
      // Planlamanın belirlediği kuyruk sırasıyla aynı: acil → priority → en eski
      orderBy: [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { startedAt: { sort: "asc", nulls: "last" } },
      ],
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
          priority: s.priority,
          isUrgent: s.isUrgent,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return { success: true, data };
  }

  // ---------------------------------------------------------------------------
  // PER-ROLL ACTIONS
  // ---------------------------------------------------------------------------
  /**
   * Bir topun Kalite Kontrol 2 işlemini tamamla (per-roll).
   * Toplar teker teker `QC2_COMPLETED` işaretlenir; tüm roller bittiğinde
   * operatör `finishStep` çağrısıyla adımı kapatır.
   *
   * Otomatik yetenek aktarımı: bu istasyona atanmış property capability'leri
   * Roll'a RollProperty olarak kopyalanır (skipDuplicates). Capability listesi
   * KURSUN'u içeriyorsa KURSUN_APPLIED log'u da otomatik atılır — eski per-roll
   * "Kurşun geçildi mi?" toggle'ının yerini alır.
   */
  async completeQc2(
    data: { rollId: string; stepId: string; notes?: string | null },
    userId?: string,
    machineId?: string | null
  ): Promise<ApiResponse<RollOperation>> {
    await this.assertRollInStep(data.rollId, data.stepId, StationKind.PROCESS_QC);

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      select: { stationId: true },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");

    const hasKursunCap = await prisma.stationProperty.findFirst({
      where: { stationId: step.stationId, property: { code: "KURSUN" } },
      select: { id: true },
    });

    const op = await prisma.$transaction(async (tx) => {
      const qc2Op = await tx.rollOperation.upsert({
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
          machineId: machineId ?? null,
          metadata: data.notes ? { notes: data.notes } : undefined,
        },
        update: {},
      });

      if (hasKursunCap) {
        await tx.rollOperation.upsert({
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
            machineId: machineId ?? null,
          },
          update: {},
        });
      }

      await copyStationCapabilitiesToRoll(tx, {
        stationId: step.stationId,
        rollId: data.rollId,
      });

      return qc2Op;
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
        kursunAutoApplied: !!hasKursunCap,
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
      defectTypeId: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    const roll = await prisma.roll.findUnique({ where: { id: data.rollId } });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    if (data.startMeter > Number(roll.currentQty)) {
      throw AppError.badRequest(
        `Hata metresi (${data.startMeter}) topun metrajını (${Number(roll.currentQty)}) aşıyor`
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
        defectTypeId: defectType.id,
        errorType: defectType.name,
      },
    });

    return {
      success: true,
      data: err,
      message: `${defectType.name} · ${data.startMeter}. metrede`,
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

      // QC2_COMPLETED / KURSUN_APPLIED işaretleri ve RollProperty kayıtları
      // korunur — operatör eski veriyi görsün, üzerinde oynayabilsin.
      // Sıfırlamak isterse per-roll `undoQc2` kullanır.

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

    // Adımda şu anda açık olan rollerin hareket kayıtları.
    // Sıralama: enteredAt (en eski önce) — operatör fiziksel sırayı görür.
    // WO-level priority/acil rozeti `open-cards` listesinde yer alır,
    // tek bir kart açıldığında ruloların kendi içinde sıralama önemsiz.
    const openMovements = await prisma.rollMovement.findMany({
      where: { workOrderStepId: stepId, exitedAt: null },
      select: {
        roll: { select: { id: true, barcode: true, currentQty: true } },
      },
      orderBy: { enteredAt: "asc" },
    });

    const rollIds = openMovements.map((m) => m.roll.id);
    const [qc2Ops, errors, kursunCap] = await Promise.all([
      // Tambur kalıtım kayıtları sayılmaz — bu step'te fiilen yapılan QC2.
      prisma.rollOperation.findMany({
        where: {
          workOrderStepId: stepId,
          rollId: { in: rollIds },
          operationType: RollOperationType.QC2_COMPLETED,
          inheritedFromParentRollId: null,
        },
        select: { rollId: true },
      }),
      prisma.rollError.findMany({
        where: { rollId: { in: rollIds }, detectedAtStepId: stepId },
        select: {
          id: true,
          rollId: true,
          startMeter: true,
          defectTypeId: true,
          errorType: true,
        },
        orderBy: { startMeter: "asc" },
      }),
      prisma.stationProperty.findFirst({
        where: { stationId: step.stationId, property: { code: "KURSUN" } },
        select: { id: true },
      }),
    ]);

    const qc2DoneSet = new Set(qc2Ops.map((o) => o.rollId));
    const defectsByRoll = new Map<string, RollDefectSummary[]>();
    for (const e of errors) {
      if (!defectsByRoll.has(e.rollId)) defectsByRoll.set(e.rollId, []);
      defectsByRoll.get(e.rollId)!.push({
        id: e.id,
        startMeter: Number(e.startMeter),
        defectTypeId: e.defectTypeId,
        errorType: e.errorType,
      });
    }

    const rolls: RollSummary[] = openMovements.map((m) => {
      const defects = defectsByRoll.get(m.roll.id) ?? [];
      return {
        rollId: m.roll.id,
        barcode: m.roll.barcode,
        currentQty: Number(m.roll.currentQty),
        qc2Completed: qc2DoneSet.has(m.roll.id),
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
        appliesKursun: !!kursunCap,
        rolls,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // PLANLAMA — KURŞUN KUYRUĞU (WO seviyesinde)
  // ---------------------------------------------------------------------------
  /**
   * Tüm açık PROCESS_QC adımlarının (WO seviyesinde) birleşik kuyruğu.
   * Planlama Electron sayfası bu listeyi alır, drag-drop ile WO sıralar;
   * tablet `open-cards` listesi de aynı priority'i okur, operatör aynı
   * sırada görür.
   *
   * Filtre: station.kind = PROCESS_QC + status != COMPLETED + en az 1 açık top.
   * Sıralama: önce isUrgent, sonra urgentMarkedAt, sonra priority, son
   * startedAt (en eski adım önce).
   */
  async listQueue(): Promise<ApiResponse<KursunQueueItem[]>> {
    const steps = await prisma.workOrderStep.findMany({
      where: {
        station: { kind: StationKind.PROCESS_QC },
        status: { not: StepStatus.COMPLETED },
        currentRolls: { some: {} },
      },
      select: {
        id: true,
        priority: true,
        isUrgent: true,
        urgentMarkedAt: true,
        station: { select: { name: true } },
        workOrder: {
          select: {
            id: true,
            batchNumber: true,
            targetItem: { select: { name: true } },
            targetColor: { select: { name: true, hex: true } },
            travelerCards: {
              where: { status: "ACTIVE" },
              select: { cardNumber: true, barcode: true },
              take: 1,
            },
          },
        },
        movements: {
          where: { exitedAt: null },
          select: {
            enteredAt: true,
            roll: { select: { currentQty: true } },
          },
        },
      },
      orderBy: [
        { isUrgent: "desc" },
        { urgentMarkedAt: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { startedAt: { sort: "asc", nulls: "last" } },
      ],
    });

    const data: KursunQueueItem[] = steps.map((s) => {
      const oldest = s.movements.reduce<Date | null>((acc, m) => {
        if (acc === null) return m.enteredAt;
        return m.enteredAt < acc ? m.enteredAt : acc;
      }, null);
      const totalQty = s.movements.reduce(
        (sum, m) => sum + Number(m.roll.currentQty),
        0,
      );
      const card = s.workOrder.travelerCards[0] ?? null;
      return {
        workOrderStepId: s.id,
        stationName: s.station.name,
        workOrderId: s.workOrder.id,
        batchNumber: s.workOrder.batchNumber,
        travelerCardNumber: card?.cardNumber ?? null,
        travelerCardBarcode: card?.barcode ?? null,
        itemName: s.workOrder.targetItem?.name ?? null,
        colorName: s.workOrder.targetColor?.name ?? null,
        colorHex: s.workOrder.targetColor?.hex ?? null,
        openRollCount: s.movements.length,
        totalCurrentQty: totalQty,
        oldestEnteredAt: oldest,
        priority: s.priority,
        isUrgent: s.isUrgent,
        urgentMarkedAt: s.urgentMarkedAt,
      };
    });

    return { success: true, data };
  }

  /**
   * Drag-drop sonrası planlama gönderir. WorkOrderStep.priority batch update.
   * Sadece açık (status != COMPLETED) PROCESS_QC step'leri günceller.
   */
  async reorderQueue(
    items: Array<{ id: string; priority: number }>,
    userId: string | undefined,
  ): Promise<ApiResponse<{ updated: number }>> {
    if (!userId) throw AppError.unauthorized();
    if (items.length === 0) return { success: true, data: { updated: 0 } };

    const ids = items.map((i) => i.id);
    const existing = await prisma.workOrderStep.findMany({
      where: {
        id: { in: ids },
        status: { not: StepStatus.COMPLETED },
        station: { kind: StationKind.PROCESS_QC },
      },
      select: { id: true },
    });
    const editable = new Set(existing.map((e) => e.id));
    const filtered = items.filter((i) => editable.has(i.id));
    if (filtered.length === 0) return { success: true, data: { updated: 0 } };

    const updateIds = filtered.map((i) => i.id);
    const updatePriorities = filtered.map((i) => i.priority);
    await prisma.$executeRaw`
      UPDATE "work_order_steps" AS wos
      SET "priority" = data."priority"
      FROM unnest(${updateIds}::text[], ${updatePriorities}::int[]) AS data("id", "priority")
      WHERE wos."id" = data."id"
    `;

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: filtered.map((i) => i.id).join(","),
      newData: { reorderedCount: filtered.length, kursunQueue: true },
    });

    return { success: true, data: { updated: filtered.length } };
  }

  /**
   * Acil rozeti aç/kapat (WO bazında — PROCESS_QC step üzerinde).
   * Sadece açık (COMPLETED olmayan) step'lerde anlamlı.
   */
  async setQueueUrgent(
    stepId: string,
    isUrgent: boolean,
    userId: string | undefined,
  ): Promise<ApiResponse<{ id: string; isUrgent: boolean; urgentMarkedAt: Date | null }>> {
    if (!userId) throw AppError.unauthorized();

    const existing = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: {
        id: true,
        isUrgent: true,
        status: true,
        station: { select: { kind: true } },
      },
    });
    if (!existing) throw AppError.notFound("Adım bulunamadı");
    if (existing.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest("Bu adım Kurşun + QC2 tipinde değil");
    }
    if (existing.status === StepStatus.COMPLETED) {
      throw AppError.badRequest("Adım tamamlanmış, acil işaretlenemez");
    }

    const updated = await prisma.workOrderStep.update({
      where: { id: stepId },
      data: {
        isUrgent,
        urgentMarkedAt: isUrgent ? new Date() : null,
      },
      select: { id: true, isUrgent: true, urgentMarkedAt: true },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: stepId,
      oldData: { isUrgent: existing.isUrgent },
      newData: { isUrgent: updated.isUrgent, kursunQueue: true },
    });

    return { success: true, data: updated };
  }
}

// Satisfy strict unused-locals for import Prisma (type-only usage).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _PrismaKeep = Prisma.TransactionClient;
