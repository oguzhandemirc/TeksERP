// =============================================================================
// Tambur Service / report-error
// =============================================================================
// Tambur'da hata bildirimi (reportError).
// `tambur.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../tambur.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  RollStatus,
  RollError,
} from "@prisma/client";
import { recordRollDefectTx } from "../helpers/roll-defect.helper";

export async function reportError(
    data: {
      rollId: string;
      stepId: string;
      startMeter: number;
      defectTypeId: string;
    },
    userId?: string
  ): Promise<ApiResponse<RollError>> {
    const roll = await prisma.roll.findUnique({ where: { id: data.rollId }, select: { currentStepId: true, barcode: true } });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    // Top bu Tambur adımında olmalı (operatöre Tambur diliyle; helper tx içinde yeniden ölçer).
    if (roll.currentStepId !== data.stepId) {
      throw AppError.badRequest(
        `Top (${roll.barcode}) şu anda bu Tambur adımında değil`
      );
    }

    // Kapı (Tambur ekran ailesi + muayene), tip, mükerrer kuralları TEK boğazda
    // (`recordRollDefectTx`, KQ-D7) — KK2 ile AYNI kurallar, parite kopyası yok.
    const rec = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (finalize ile yarış): create'ten önce top satır-kilitlenir
      // ve hâlâ bu Tambur adımında IN_PRODUCTION olduğu tx İÇİNDE doğrulanır;
      // aksi halde eşzamanlı finalize'dan SONRA commit eden hata sonsuza dek
      // açık yetim kalırdı (closeOrphanRollErrors onu göremezdi).
      const claim = await tx.roll.updateMany({
        where: {
          id: data.rollId,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: data.stepId,
        },
        data: { updatedAt: new Date() },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işlemle değişti (finalize edilmiş olabilir). Listeyi yenileyip tekrar deneyin."
        );
      }
      return recordRollDefectTx(tx, {
        rollId: data.rollId,
        stepId: data.stepId,
        startMeter: data.startMeter,
        defectTypeId: data.defectTypeId,
        userId,
        stationGate: "TAMBUR",
      });
    });
    const err = rec.error;
    const created = rec.auditPayload.defects[0];

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL_ERROR",
      recordId: err.id,
      newData: {
        rollId: data.rollId,
        stepId: data.stepId,
        startMeter: data.startMeter,
        defectTypeId: created.defectTypeId,
        errorType: created.errorType,
        source: "TAMBUR",
      },
    });

    return {
      success: true,
      data: err,
      message: `${created.errorType} · ${data.startMeter}. metrede`,
    };
  }
