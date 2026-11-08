// =============================================================================
// TeksERP - WorkOrder (Parti) Service / attach-hard-delete
// =============================================================================
// Taslak iş emrinin kalıcı silinmesi (hardDelete) ve top bağlama (attachRolls).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================

import { warehouseStampWhereTx } from "../helpers/warehouse.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  WorkOrder,
  WorkOrderStatus,
  RollStatus,
  StepStatus,
  Prisma,
} from "@prisma/client";
import {
  recordWorkOrderFieldChangesTx,
} from "../helpers/workorder-event.helper";
import { setWorkOrderCardStatusesTx } from "../helpers/traveler-card-fanout.helper";
import { addBatchToWorkOrderTx, auditBatchAdd } from "../workorder-batch-add.service";
import { resolveDocumentBatchNo } from "../helpers/document-batch-no.helper";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { normalizeScanCode } from "../../utils/code-format";
import { TERIM } from "../../constants/terim";

export async function hardDelete(id: string, userId?: string, opts: { releaseToken?: boolean } = {}): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: { select: { id: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    }

    if (existing.status === WorkOrderStatus.IN_PROGRESS) {
      throw AppError.conflict(
        `Üretimdeki ${TERIM.terbiyeIsEmri.tekilKucuk} arşivlenemez. Önce iptal edin.`
      );
    }

    if (!existing.isActive) {
      throw AppError.conflict(`Bu ${TERIM.terbiyeIsEmri.tekilKucuk} zaten arşivli.`);
    }

    const stepIds = existing.steps.map((s) => s.id);

    const archived = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: tx başında WO satırını write-kilitle + "arşivlenebilir"
      // (isActive + IN_PROGRESS değil) olduğunu iddia et. tx-DIŞI ön-kontrol
      // (2520/2526) UX; eşzamanlı bir geçiş WO'yu IN_PROGRESS yaparsa ya da başka
      // bir istek aynı anda arşivlerse bu claim count===0 → 409 (çift-arşiv / çift
      // top-geri-çekme önlenir). Asıl isActive=false yazımı aşağıda kalır.
      const archiveClaim = await tx.workOrder.updateMany({
        where: { id, isActive: true, status: { not: WorkOrderStatus.IN_PROGRESS } },
        data: { updatedAt: new Date() },
      });
      if (archiveClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { isActive: true, status: true },
        });
        throw AppError.conflict(
          fresh && !fresh.isActive
            ? `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada arşivlendi.`
            : `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada üretime geçti, arşivlenemez. Önce iptal edin.`
        );
      }

      if (stepIds.length > 0) {
        // Aktif üretimdeki topları STOCK'a geri çek (currentStepId null,
        // status STOCK). producedInStepId KORUNUR — lineage; step kaydı
        // hala DB'de (soft delete). Bu sayede ileride "bu top hangi WO'dan
        // çıktı?" sorgusu cevap verir.
        // Damga flip'ten ÖNCE (gerekçe: `softDelete` yolundaki aynı not).
        const arsivTopWhere = {
          currentStepId: { in: stepIds },
          status: RollStatus.IN_PRODUCTION,
        } satisfies Prisma.RollWhereInput;
        await warehouseStampWhereTx(tx, arsivTopWhere);
        await tx.roll.updateMany({
          where: arsivTopWhere,
          data: {
            status: RollStatus.STOCK,
            currentStepId: null,
          },
        });

        // M-12: arşivlenen WO'nun açık movement'larını kapat + adımları
        // terminal duruma çek (softDelete ile aynı gerekçe).
        await tx.$executeRaw`
          UPDATE roll_movements m
          -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
          SET "exitedAt" = now(),
              "qtyOut" = COALESCE(m."qtyOut", r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_ARCHIVED'
                           ELSE m.notes || ' | WO_ARCHIVED' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
            AND m."revokedAt" IS NULL
        `;
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "WO_ARCHIVED" },
        });
      }

      // ACTIVE refakat kartı VOID edilir — quickStart zero-attach telafisi ve
      // planlamacı arşivi DB'de arşivli WO'ya bağlı hayalet ACTIVE kart
      // bırakmasın (softDelete'teki bloğun simetriği).
      await setWorkOrderCardStatusesTx(tx, id, "ACTIVE", "VOIDED", { voidReason: "WO_ARCHIVED" });

      // Token YALNIZ hızlı iş emri telafisinde bırakılır (`releaseToken`): iki istemci P3 borcunda, düzeltilmiş
      // tekrar boş token'a güveniyor. Arşiv ucu token'ı TUTAR → aynı gönderimin tekrarı 409 WORK_ORDER_CANCELLED.
      if (opts.releaseToken) await tx.workOrder.update({ where: { id }, data: { clientToken: null } });
      const archivedRow = await tx.workOrder.update({
        where: { id },
        data: { isActive: false },
      });
      await recordWorkOrderFieldChangesTx(
        tx,
        id,
        [{ field: "isActive", from: "true", to: "false", fromLabel: "Aktif", toLabel: "Arşivlendi" }],
        { trigger: "WO_ARCHIVE", userId },
      );
      return archivedRow;
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: {
        batchNumber: existing.workOrderNumber,
        type: existing.type,
        status: existing.status,
        stepCount: existing.steps.length,
      },
      newData: { isActive: false, event: "ARCHIVED" },
    });

    return {
      success: true,
      data: archived,
      message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} arşivlendi: ${existing.workOrderNumber}`,
    };
  }

export async function attachRolls(
    workOrderId: string,
    rawBarcodes: string[],
    userId?: string,
    opts: { sourceNoteId?: string | null; sourceBatchNo?: string | null } = {},
  ): Promise<ApiResponse<{ attached: number; errors: string[]; batch: { id: string; batchNumber: string } | null }>> {
    const barcodes = rawBarcodes.map(normalizeScanCode).filter(Boolean);
    const res = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      const documentBatchNo = await resolveDocumentBatchNo(tx, opts.sourceNoteId, opts.sourceBatchNo);
      return addBatchToWorkOrderTx(tx, { workOrderId, barcodes, userId, mode: "LENIENT", recordEvent: false, documentBatchNo });
    }));
    await auditBatchAdd(workOrderId, res, userId);
    return {
      success: true,
      data: { attached: res.attached.length, errors: res.errors, batch: res.batch },
      message: `${res.attached.length} top ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} bağlandı`,
    };
  }
