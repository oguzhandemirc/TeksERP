// =============================================================================
// TeksERP - Production Service
// =============================================================================
// Handles shop-floor tablet operations:
//   - Station start/finish tracking via step-action
//   - Subcontractor handling with shrinkage (newQty required for EXTERNAL)
//   - Defect reporting at Kurşun (QC2) station
//   - Active production dashboard
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import {
  StepStatus,
  StationType,
  WorkOrderStep,
  RollError,
  RollStatus,
  WorkOrderStatus,
  Prisma,
} from "@prisma/client";
import {
  isRollActiveInStep,
  hasRollCompletedStep,
  openMovementForNextStep,
  recomputeStepStatus,
  getRollStepState,
  canRollGoBackFromStep,
} from "./helpers/roll-step.helper";

export class ProductionService {
  /**
   * Execute a station action (START, FINISH, SKIP) on a work order step.
   *
   * Business Rules:
   *   - START:  PENDING → ACTIVE, startedAt set
   *   - FINISH: ACTIVE  → COMPLETED, RollMovement kapatılır, top bir sonraki adıma geçer
   *   - SKIP:   PENDING/ACTIVE → SKIPPED, reason zorunlu, top bir sonraki adıma geçer
   *   - EXTERNAL station FINISH: MUST include newQty to account for shrinkage/waste
   */
  async executeStepAction(
    data: {
      barcode: string;
      stationId: string;
      action: "START" | "FINISH" | "SKIP";
      newQty?: number;
      newWeight?: number;
      reason?: string; // SKIP için zorunlu
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({ where: { barcode: data.barcode } });
    if (!roll) {
      // Refakat kartı barkodu mu? (RK-YYMM-XXXXXX-C formatı)
      if (/^RK-\d{4}-[0-9A-Z]+-[0-9A-Z]$/i.test(data.barcode)) {
        throw AppError.badRequest(
          `Bu bir refakat kartı barkodu. Üretim akışı yalnızca top (roll) barkodları ile çalışır. ` +
          `Lütfen "Saha → Refakat Kartı Tarama" ekranını kullanın.`
        );
      }
      throw AppError.notFound(`Top barkodu bulunamadı: ${data.barcode}`);
    }

    if (!roll.currentStepId) {
      throw AppError.badRequest("Top şu anda hiçbir üretim adımında değil");
    }

    const currentStep = await prisma.workOrderStep.findUnique({
      where: { id: roll.currentStepId },
      include: {
        station: true,
        workOrder: {
          include: {
            steps: {
              orderBy: { stepSequence: "asc" },
            },
          },
        },
      },
    });

    if (!currentStep) {
      throw AppError.notFound("Mevcut üretim adımı bulunamadı");
    }

    if (currentStep.stationId !== data.stationId) {
      throw AppError.badRequest(
        `Top bu istasyonda değil. Mevcut istasyon: ${currentStep.station.name}`
      );
    }

    // Fason (EXTERNAL) istasyonlarda operator START/FINISH yapamaz.
    // Bu adımlar /api/subcontractor/dispatch ve /api/subcontractor/receive ile yönetilir.
    if (currentStep.station.type === StationType.EXTERNAL && data.action !== "SKIP") {
      throw AppError.badRequest(
        `"${currentStep.station.name}" fason/dış istasyonudur. ` +
        `Bu adım için "Fason Sevk" veya "Fason Mal Kabul" ekranını kullanın.`
      );
    }

    switch (data.action) {
      case "START":
        return this.handleStepStart(currentStep, roll, userId);
      case "FINISH":
        return this.handleStepFinish(currentStep, roll, data, userId);
      case "SKIP":
        return this.handleStepSkip(currentStep, roll, data.reason ?? "", userId);
      default:
        throw AppError.badRequest(`Bilinmeyen action: ${data.action}`);
    }
  }

  /**
   * Tablet üzerinde operatör barkodu okuduğunda gösterilecek:
   *   - Top özeti
   *   - Mevcut step (status, station, notes) + sonraki step
   *   - O istasyona uyarlanmış step bilgisi (istasyonId verilirse eşleşme kontrolü)
   */
  async getStepInfo(
    barcode: string,
    stationId?: string
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode },
      include: {
        item: true,
        color: true,
      },
    });
    if (!roll) {
      if (/^RK-\d{4}-[0-9A-Z]+-[0-9A-Z]$/i.test(barcode)) {
        throw AppError.badRequest(
          `Bu bir refakat kartı barkodu. Üretim akışı yalnızca top (roll) barkodları ile çalışır.`
        );
      }
      throw AppError.notFound(`Top barkodu bulunamadı: ${barcode}`);
    }

    if (!roll.currentStepId) {
      return {
        success: true,
        data: {
          roll,
          currentStep: null,
          nextStep: null,
          stationMatches: false,
          message: "Top şu anda hiçbir üretim adımında değil",
        },
      };
    }

    const currentStep = await prisma.workOrderStep.findUnique({
      where: { id: roll.currentStepId },
      include: {
        station: true,
        workOrder: {
          include: {
            steps: {
              include: { station: true },
              orderBy: { stepSequence: "asc" },
            },
            orderLinks: {
              include: {
                orderLine: {
                  include: { order: { include: { customer: true } }, item: true },
                },
              },
            },
          },
        },
      },
    });

    if (!currentStep) {
      throw AppError.notFound("Mevcut üretim adımı bulunamadı");
    }

    const allSteps = currentStep.workOrder.steps;
    const idx = allSteps.findIndex((s) => s.id === currentStep.id);
    const nextStep = idx < allSteps.length - 1 ? allSteps[idx + 1] : null;

    const stationMatches = stationId ? currentStep.stationId === stationId : true;

    // Roll-seviyesi durum bayrakları (düğmeler için)
    const [openMovement, closedMovement] = await Promise.all([
      prisma.rollMovement.findFirst({
        where: {
          rollId: roll.id,
          workOrderStepId: currentStep.id,
          exitedAt: null,
        },
        select: { id: true, enteredAt: true },
      }),
      prisma.rollMovement.findFirst({
        where: {
          rollId: roll.id,
          workOrderStepId: currentStep.id,
          exitedAt: { not: null },
        },
        select: { id: true },
      }),
    ]);

    const rollActive = !!openMovement;
    const rollCompleted = !!closedMovement;
    const isExternal = currentStep.station.type === "EXTERNAL";

    // EXTERNAL istasyonlarda START/FINISH operatörle değil, fason dispatch/receive ile yürür.
    const canStart = stationMatches && !rollActive && !rollCompleted && !isExternal;
    const canFinish = stationMatches && rollActive && !isExternal;
    const canSkip = stationMatches && !rollCompleted;

    return {
      success: true,
      data: {
        roll,
        currentStep: {
          id: currentStep.id,
          stepSequence: currentStep.stepSequence,
          status: currentStep.status,
          notes: currentStep.notes,
          stepData: currentStep.stepData,
          station: currentStep.station,
          startedAt: currentStep.startedAt,
          rollActive,
          rollCompleted,
          canStart,
          canFinish,
          canSkip,
          isExternal,
          rollMovementStartedAt: openMovement?.enteredAt ?? null,
        },
        nextStep: nextStep
          ? {
              id: nextStep.id,
              stepSequence: nextStep.stepSequence,
              station: nextStep.station,
              notes: nextStep.notes,
            }
          : null,
        stationMatches,
        stationMismatchMessage: !stationMatches
          ? `Top bu istasyonda değil. Mevcut: ${currentStep.station.name}`
          : null,
        workOrder: {
          id: currentStep.workOrder.id,
          batchNumber: currentStep.workOrder.batchNumber,
          status: currentStep.workOrder.status,
          width: currentStep.workOrder.width,
          targetQuantity: currentStep.workOrder.targetQuantity,
          orderLinks: currentStep.workOrder.orderLinks,
        },
        allSteps: allSteps.map((s) => ({
          id: s.id,
          stepSequence: s.stepSequence,
          status: s.status,
          station: s.station,
        })),
      },
    };
  }

  private async handleStepStart(
    step: WorkOrderStep & { station: { name: string } },
    roll: { id: string; currentQty: number; weightKg: number | null },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const { active, completed } = await getRollStepState(
      prisma as unknown as Prisma.TransactionClient,
      roll.id,
      step.id
    );

    if (active) {
      throw AppError.badRequest(
        `Bu top "${step.station.name}" istasyonunda zaten başlatılmış. FINISH ile tamamlayın.`
      );
    }
    if (completed) {
      throw AppError.badRequest(
        `Bu top "${step.station.name}" adımını zaten tamamlamış.`
      );
    }

    const prevStatus = step.status;

    await prisma.$transaction(async (tx) => {
      // Eğer bu step için roll'un hiç movement'i yoksa aç.
      // (Genelde ilk adıma giriş workorder.attachRolls ile olur; diğer
      // adımlara giriş FINISH ile otomatik açılır. Elle START basmak da
      // bu sayede çalışır.)
      const any = await tx.rollMovement.findFirst({
        where: { rollId: roll.id, workOrderStepId: step.id },
        select: { id: true },
      });
      if (!any) {
        await tx.rollMovement.create({
          data: {
            rollId: roll.id,
            workOrderStepId: step.id,
            qtyIn: roll.currentQty,
            weightIn: roll.weightKg,
            operatorId: userId ?? null,
          },
        });
      }
      await recomputeStepStatus(tx, step.id);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      oldData: { status: prevStatus, rollActive: false },
      newData: { status: StepStatus.ACTIVE, rollActive: true, rollId: roll.id },
    });

    return {
      success: true,
      data: {
        stepId: step.id,
        action: "START",
        stationName: step.station.name,
        rollId: roll.id,
      },
      message: `İstasyon işlemi başlatıldı: ${step.station.name}`,
    };
  }

  private async handleStepFinish(
    step: WorkOrderStep & {
      station: { name: string; type: StationType };
      workOrder: { id: string; steps: WorkOrderStep[] };
    },
    roll: { id: string; currentQty: number; weightKg: number | null },
    data: { newQty?: number; newWeight?: number },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    // Roll bazlı kontrol: bu top bu step'te gerçekten aktif mi?
    const active = await isRollActiveInStep(
      prisma as unknown as Prisma.TransactionClient,
      roll.id,
      step.id
    );
    if (!active) {
      const completed = await hasRollCompletedStep(
        prisma as unknown as Prisma.TransactionClient,
        roll.id,
        step.id
      );
      if (completed) {
        throw AppError.badRequest(
          `Bu top "${step.station.name}" adımını zaten tamamlamış.`
        );
      }
      throw AppError.badRequest(
        `Bu top "${step.station.name}" istasyonunda henüz başlatılmamış. Önce START basın.`
      );
    }

    if (step.station.type === StationType.EXTERNAL) {
      if (data.newQty === undefined && data.newWeight === undefined) {
        throw AppError.badRequest(
          "Fason (dış) istasyon tamamlamasında yeni metraj veya kilo zorunludur (fire/çekme hesabı)"
        );
      }
    }

    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    const nextStep = currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    const newQty = data.newQty ?? roll.currentQty;
    const newWeight = data.newWeight ?? roll.weightKg;

    await prisma.$transaction(async (tx) => {
      // Açık RollMovement'i kapat
      await tx.rollMovement.updateMany({
        where: {
          rollId: roll.id,
          workOrderStepId: step.id,
          exitedAt: null,
        },
        data: {
          exitedAt: new Date(),
          qtyOut: newQty,
          weightOut: newWeight,
        },
      });

      // Top miktar/kilo güncelle
      await tx.roll.update({
        where: { id: roll.id },
        data: {
          currentQty: newQty,
          weightKg: newWeight,
        },
      });

      if (nextStep) {
        // Otomatik olarak sonraki adımı aç (yeni RollMovement + currentStepId)
        await openMovementForNextStep(tx, {
          rollId: roll.id,
          nextStepId: nextStep.id,
          qty: newQty,
          weight: newWeight,
          userId: userId ?? null,
          notes: `AUTO_FROM_STEP:${step.id}`,
        });
      } else {
        // Son adım — top üretim hattından çıktı, PRODUCED'a çek
        await tx.roll.update({
          where: { id: roll.id },
          data: {
            currentStepId: null,
            status: RollStatus.PRODUCED,
          },
        });
      }

      // Bu step'in rollup durumunu recompute et (diğer roller hala açıksa ACTIVE kalır)
      await recomputeStepStatus(tx, step.id);

      // WO'nun tüm adımları COMPLETED veya SKIPPED olduysa WO'yu COMPLETED'a çek
      if (!nextStep) {
        const remaining = await tx.workOrderStep.count({
          where: {
            workOrderId: step.workOrder.id,
            status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
          },
        });
        if (remaining === 0) {
          await tx.workOrder.update({
            where: { id: step.workOrder.id },
            data: { status: WorkOrderStatus.COMPLETED },
          });
          await tx.travelerCard.updateMany({
            where: { workOrderId: step.workOrder.id, status: "ACTIVE" },
            data: { status: "COMPLETED" },
          });
        }
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      oldData: { rollActive: true, currentQty: roll.currentQty },
      newData: {
        rollActive: false,
        currentQty: newQty,
        nextStepId: nextStep?.id ?? null,
        autoStartedNext: !!nextStep,
      },
    });

    return {
      success: true,
      data: {
        stepId: step.id,
        action: "FINISH",
        stationName: step.station.name,
        rollId: roll.id,
        oldQty: roll.currentQty,
        newQty,
        nextStep: nextStep
          ? {
              id: nextStep.id,
              sequence: nextStep.stepSequence,
              autoStarted: true,
            }
          : "SON_ADIM",
      },
      message: nextStep
        ? `Adım tamamlandı. Sonraki istasyon otomatik açıldı.`
        : "Tüm rota tamamlandı!",
    };
  }

  /**
   * R6 — Bir istasyonu atla (SKIPPED).
   * Top miktarı değişmeden bir sonraki adıma taşınır, RollMovement kapama SKIPPED notu ile yapılır.
   */
  private async handleStepSkip(
    step: WorkOrderStep & {
      station: { name: string; type: StationType };
      workOrder: { id: string; steps: WorkOrderStep[] };
    },
    roll: { id: string; currentQty: number; weightKg: number | null },
    reason: string,
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (reason.trim().length < 3) {
      throw AppError.badRequest("Atlama için gerekçe zorunlu (en az 3 karakter)");
    }

    // SKIPPED de terminal bir movement; daha önce kapatılmışsa tekrar atlatılamaz
    const completed = await hasRollCompletedStep(
      prisma as unknown as Prisma.TransactionClient,
      roll.id,
      step.id
    );
    if (completed) {
      throw AppError.badRequest(
        `Bu top "${step.station.name}" adımını zaten tamamlamış/atlamış.`
      );
    }

    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    const nextStep = currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    await prisma.$transaction(async (tx) => {
      // Açık movement varsa kapat, yoksa "phantom" kapalı movement oluştur
      const open = await tx.rollMovement.findFirst({
        where: {
          rollId: roll.id,
          workOrderStepId: step.id,
          exitedAt: null,
        },
        select: { id: true },
      });

      if (!open) {
        await tx.rollMovement.create({
          data: {
            rollId: roll.id,
            workOrderStepId: step.id,
            qtyIn: roll.currentQty,
            weightIn: roll.weightKg,
            qtyOut: roll.currentQty,
            weightOut: roll.weightKg,
            exitedAt: new Date(),
            operatorId: userId ?? null,
            notes: `SKIPPED: ${reason}`,
          },
        });
      }

      await tx.rollMovement.updateMany({
        where: {
          rollId: roll.id,
          workOrderStepId: step.id,
          exitedAt: null,
        },
        data: {
          exitedAt: new Date(),
          qtyOut: roll.currentQty,
          weightOut: roll.weightKg,
          notes: `SKIPPED: ${reason}`,
        },
      });

      if (nextStep) {
        await openMovementForNextStep(tx, {
          rollId: roll.id,
          nextStepId: nextStep.id,
          qty: roll.currentQty,
          weight: roll.weightKg,
          userId: userId ?? null,
          notes: `PREV_STEP_SKIPPED:${step.id}`,
        });
      } else {
        await tx.roll.update({
          where: { id: roll.id },
          data: { currentStepId: null, status: RollStatus.PRODUCED },
        });
      }

      // Step rollup durumunu recompute et
      await recomputeStepStatus(tx, step.id);

      // WO son step atlandıysa complete olabilir
      if (!nextStep) {
        const remaining = await tx.workOrderStep.count({
          where: {
            workOrderId: step.workOrder.id,
            status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
          },
        });
        if (remaining === 0) {
          await tx.workOrder.update({
            where: { id: step.workOrder.id },
            data: { status: WorkOrderStatus.COMPLETED },
          });
          await tx.travelerCard.updateMany({
            where: { workOrderId: step.workOrder.id, status: "ACTIVE" },
            data: { status: "COMPLETED" },
          });
        }
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      oldData: { rollSkipped: false },
      newData: {
        rollSkipped: true,
        rollId: roll.id,
        skipReason: reason,
        autoStartedNext: !!nextStep,
      },
    });

    return {
      success: true,
      data: {
        stepId: step.id,
        action: "SKIP",
        stationName: step.station.name,
        rollId: roll.id,
        nextStep: nextStep
          ? { id: nextStep.id, sequence: nextStep.stepSequence }
          : "SON_ADIM",
      },
      message: `İstasyon atlandı: ${step.station.name}`,
    };
  }

  /**
   * Get active production steps (dashboard).
   * Returns all steps currently being processed.
   */
  async getActiveSteps(): Promise<ApiResponse<WorkOrderStep[]>> {
    const activeSteps = await prisma.workOrderStep.findMany({
      where: { status: StepStatus.ACTIVE },
      include: {
        station: true,
        workOrder: true,
      },
      orderBy: { startedAt: "desc" },
    });

    return { success: true, data: activeSteps };
  }

  /**
   * Report a defect at Kurşun (QC2) station.
   * Creates a RollError record with isProcessed = false.
   * These errors will be input for the Tambur decision point.
   */
  async reportError(
    data: {
      rollId: string;
      startMeter: number;
      endMeter: number;
      errorType?: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    // Verify roll exists
    const roll = await prisma.roll.findUnique({ where: { id: data.rollId } });
    if (!roll) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (data.startMeter >= data.endMeter) {
      throw AppError.badRequest("Başlangıç metresi bitiş metresinden küçük olmalı");
    }

    if (data.endMeter > roll.currentQty) {
      throw AppError.badRequest(
        `Bitiş metresi (${data.endMeter}) toplam metrajdan (${roll.currentQty}) büyük olamaz`
      );
    }

    const rollError = await prisma.rollError.create({
      data: {
        rollId: data.rollId,
        startMeter: data.startMeter,
        endMeter: data.endMeter,
        errorType: data.errorType ?? null,
        isProcessed: false,
        // Lifecycle — top hangi adımdaysa orada tespit edildi varsay
        detectedAtStepId: roll.currentStepId,
        detectedByUserId: userId ?? null,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_ERROR",
      recordId: rollError.id,
      newData: {
        rollId: data.rollId,
        startMeter: data.startMeter,
        endMeter: data.endMeter,
        errorType: data.errorType,
      },
    });

    return {
      success: true,
      data: rollError,
      message: `Hata kaydı oluşturuldu: ${data.startMeter}m - ${data.endMeter}m`,
    };
  }

  // ===========================================================================
  // UNDO — Generic step finish geri alma (operatör hatası düzeltme)
  // ===========================================================================
  //
  // Kural:
  //   - Bu rulonun bu step'te kapalı movement'ı olmalı (zaten finish basıldı).
  //   - Sonraki adımda bu rulo için bir iz yoksa (ne kapalı movement, ne
  //     RollOperation, ne de aktif fason sevki) geri alınabilir.
  //   - Sonraki step'in açık movement'ı silinir, bu step'in kapalı movement'ı
  //     yeniden açılır, Roll.currentStepId bu adıma döner.
  //   - EXTERNAL adımlar için kullanılmaz — onlar fason kabul/sevk akışıyla
  //     yönetilir (cancelDispatch / cancelReceipt).
  //   - Tambur adımı için kullanılmaz — Tambur finalize farklı bir akış
  //     (split lifecycle).
  //
  async undoStepFinish(
    data: { rollId: string; stepId: string },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; stepId: string }>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: { name: true, type: true, kind: true } },
        workOrder: {
          select: {
            id: true,
            status: true,
            steps: {
              orderBy: { stepSequence: "asc" },
              select: { id: true, stepSequence: true },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.workOrder.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict("Tamamlanmış iş emrinde geri alma yapılamaz");
    }
    if (step.station.type === StationType.EXTERNAL) {
      throw AppError.badRequest(
        `"${step.station.name}" fason istasyondur — geri alma için fason kabul iptal kullanın`,
      );
    }
    if (step.station.kind === "TAMBUR") {
      throw AppError.badRequest(
        "Tambur finalize geri alınamaz — düzeltme için Tambur split akışı kullanın",
      );
    }

    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, barcode: true, currentStepId: true, currentQty: true, weightKg: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    // Bu step için kapalı movement var mı? (finish basılmış olmalı)
    const closedMovement = await prisma.rollMovement.findFirst({
      where: { rollId: data.rollId, workOrderStepId: data.stepId, exitedAt: { not: null } },
      orderBy: { exitedAt: "desc" },
      select: { id: true, qtyIn: true, weightIn: true },
    });
    if (!closedMovement) {
      throw AppError.badRequest(
        `Top ${roll.barcode} bu adımda finish basılmamış — geri alınacak işlem yok`,
      );
    }

    // Sonraki adım izi var mı?
    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    const nextStep = currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    const check = await canRollGoBackFromStep(
      prisma as unknown as Prisma.TransactionClient,
      data.rollId,
      nextStep?.id ?? null,
    );
    if (!check.canGoBack) {
      throw AppError.conflict(check.reason ?? "Geri alınamaz");
    }

    await prisma.$transaction(async (tx) => {
      // 1) Sonraki adımdaki açık movement'ı sil
      if (nextStep) {
        await tx.rollMovement.deleteMany({
          where: {
            rollId: data.rollId,
            workOrderStepId: nextStep.id,
            exitedAt: null,
          },
        });
      }

      // 2) Bu adımın kapalı movement'ını geri aç
      await tx.rollMovement.update({
        where: { id: closedMovement.id },
        data: { qtyOut: null, weightOut: null, exitedAt: null },
      });

      // 3) Roll.currentStepId bu step'e geri çek; PRODUCED → IN_PRODUCTION
      await tx.roll.update({
        where: { id: data.rollId },
        data: {
          currentStepId: data.stepId,
          ...(roll.currentStepId === null
            ? { status: RollStatus.IN_PRODUCTION }
            : {}),
          // qty/weight'ı movement'in qtyIn değerine geri çevir (operatör finish'te
          // değiştirmiş olabilir)
          currentQty: closedMovement.qtyIn ?? roll.currentQty,
          weightKg: closedMovement.weightIn ?? roll.weightKg,
        },
      });

      // 4) Bu step ve sonraki step'in status'unu recompute et
      await recomputeStepStatus(tx, step.id);
      if (nextStep) await recomputeStepStatus(tx, nextStep.id);

      // 5) WO COMPLETED olmuştuysa geri çek (son adım undo'sunda)
      if (step.workOrder.status === WorkOrderStatus.COMPLETED) {
        await tx.workOrder.update({
          where: { id: step.workOrder.id },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: step.id,
      oldData: { rollActive: false },
      newData: {
        action: "UNDO_STEP_FINISH",
        rollId: data.rollId,
        rollBarcode: roll.barcode,
        revertedToStepId: step.id,
        clearedNextStepId: nextStep?.id ?? null,
      },
    });

    return {
      success: true,
      data: { rollId: data.rollId, stepId: data.stepId },
      message: `Top ${roll.barcode} "${step.station.name}" adımına geri alındı`,
    };
  }
}
