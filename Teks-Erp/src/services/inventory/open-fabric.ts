// =============================================================================
// Inventory Service / open-fabric
// =============================================================================
// Açık kumaş girişi (createOpenFabric): token replay + taze giriş tx'i.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { lowestStage, stageForStepBirth } from "../helpers/roll-stage.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveBirthWarehouseIdTx } from "../helpers/emanet-warehouse.helper";
import { AppError } from "../../utils/app-error";
import { assertRollReplayAlive, tokenReplay } from "../helpers/token-replay.helper";
import { ApiResponse } from "../../types/api.types";
import {
  Roll,
  RollStatus,
  RollEntrySource,
  RollForm,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";
import {
  ensureWorkOrderInProgress,
  recomputeStepStatus,
} from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { assertKursunTabletMayWrite } from "../helpers/kursun-bypass-eligibility.helper";
import {
  STEP_FLOW_ERROR,
  STEP_FLOW_SELECT,
  stepRunsStepFlow,
} from "../helpers/quality-station.helper";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { resolveOwnerFromReceiptTx } from "../helpers/emanet-owner.helper";
import { TERIM } from "../../constants/terim";
import type { InventoryService } from "../inventory.service";
import type { InventoryServiceThis } from "./shared";

export async function createOpenFabric(this: InventoryServiceThis, ...args: Parameters<InventoryService["createOpenFabricFresh"]>): Promise<ApiResponse<Roll>> {
    const [data] = args;
    return this.openFabricReplay(data).run(data.clientToken, () => this.createOpenFabricFresh(...args));
  }

export function openFabricReplay(data: { receiptId: string; stepId: string }) {
    return tokenReplay<Roll, ApiResponse<Roll>>({
      find: (db, clientToken) => db.roll.findUnique({ where: { clientToken } }),
      alive: (r) => assertRollReplayAlive(r),
      identity: (r) => [
        { ad: "parentReceiptId", mevcut: r.parentReceiptId, gelen: data.receiptId },
        { ad: "producedInStepId", mevcut: r.producedInStepId, gelen: data.stepId },
      ],
      collision: "Bu istemci anahtarı FARKLI bir açık kumaş kaydı için kullanılmış. Ekranı yenileyip tekrar deneyin.",
      collisionEk: (r) => ({ rollId: r.id }),
      respond: (r) => ({ success: true, data: r, message: `Açık kumaş zaten açılmış (idempotent retry, id: ${r.id}).` }),
    });
  }

export async function createOpenFabricFresh(this: InventoryServiceThis, 
    data: {
      receiptId: string;
      stepId: string; // Kurşun/KK2 (PROCESS_QC) step
      notes?: string | null;
      /** İdempotency anahtarı — çift çağrı (retry) ikinci hayalet açık-kumaş
       *  doğurmasın (Roll.clientToken @unique; createInitialEntry emsali). */
      clientToken?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: data.receiptId },
      include: {
        appliedProperties: { select: { propertyId: true } },
        workOrder: {
          select: { id: true, status: true, targetItemId: true },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    // Açık kumaş yalnız iş emri makbuzundan açılır (dokuma makbuzu topu KK1 girişiyle doğurur).
    assertWorkOrderBound(receipt, "Mal kabul belgesi");
    if (receipt.cancelledAt) {
      throw AppError.badRequest("İptal edilmiş mal kabul üzerinden yeni kumaş açılamaz");
    }
    if (receipt.workOrder.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} tamamlanmış`);
    }
    if (!receipt.workOrder.targetItemId) {
      throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.bulunma} hedef ürün (targetItem) tanımlı değil`);
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: STEP_FLOW_SELECT },
      },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    if (step.workOrderId !== receipt.workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (!stepRunsStepFlow(step.station)) {
      throw AppError.badRequest(
        `Açık kumaş Roll sadece kart akışı yürüten adımda açılabilir — ${STEP_FLOW_ERROR}`,
      );
    }
    if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
      throw AppError.conflict(
        `Adım kapalı (${step.status}) — açık kumaş açılamaz`,
      );
    }

    const propertyIds = receipt.appliedProperties.map((p) => p.propertyId);

    const outcome = await prisma.$transaction(async (tx) => {
      // F115: WO satırını tx başında kilitle → cancelReceipt (o da tx başında
      // touchWorkOrderTx alır) ve WO-completion yollarıyla serileş. Guard'ları
      // kilit ALTINDA TAZE oku — pre-tx guard'lar (2197-2227) yalnız UX; araya
      // giren cancelReceipt/WO-tamamlama commit ederse iptalli/tamamlanmış
      // parent'a hayalet IN_PRODUCTION top doğardı (write-skew).
      await touchWorkOrderTx(tx, receipt.workOrderId);
      // K′: aynı token'ın kaybedeni iş emri satır kilidinde bekler, token'ı kilidin arkasında okur.
      const replay = data.clientToken ? await this.openFabricReplay(data).behindLock(tx, data.clientToken) : null;
      if (replay) return { fresh: false as const, replay };

      const fr = await tx.subcontractorReceipt.findUnique({
        where: { id: data.receiptId },
        select: {
          cancelledAt: true,
          workOrderId: true,
          workOrder: { select: { status: true, targetItemId: true } },
        },
      });
      if (!fr) throw AppError.notFound("Mal kabul belgesi bulunamadı");
      assertWorkOrderBound(fr, "Mal kabul belgesi");
      if (fr.cancelledAt) {
        throw AppError.conflict("Mal kabul bu sırada iptal edildi — açık kumaş açılamaz");
      }
      if (fr.workOrder.status === WorkOrderStatus.COMPLETED) {
        throw AppError.conflict(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada tamamlandı — açık kumaş açılamaz`);
      }
      if (!fr.workOrder.targetItemId) {
        throw AppError.badRequest(`${TERIM.terbiyeIsEmri.cumleBasi.bulunma} hedef ürün (targetItem) tanımlı değil`);
      }
      const fs = await tx.workOrderStep.findUnique({
        where: { id: data.stepId },
        select: { status: true },
      });
      if (!fs) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
      if (fs.status === StepStatus.COMPLETED || fs.status === StepStatus.SKIPPED) {
        throw AppError.conflict(`Adım bu sırada kapandı (${fs.status}) — açık kumaş açılamaz`);
      }
      // Kurşun bypass: adım fiziksel kurşun MAKİNESİNE dağıtılmışsa iş kâğıtta
      // yürüyor ve kapsamı DAĞITIM ANINDA dondu. Buraya yeni bir açık kumaş topu
      // eklemek iki şeyi bozar: (a) `assign` "ölçümsüz açık kumaş yok" kontrolünü
      // geçmiş bir kümeye qtyIn=0'lı top sokar → metraj bir daha sorulmaz,
      // (b) Tambur okutması kurşun adımını SESSİZCE kapattığı için (operatör onayı
      // YOK — 2026-07-31) dağıtım sonrası eklenen top, hiçbir yüzeyde görülmeden
      // kapanır ve `RollMovement.machineId` ile o makineye mal edilir.
      // Doğru yol: dağıtımı iptal et, topu aç, yeniden dağıt. Guard WO kilidinin
      // (touchWorkOrderTx) ALTINDA — `assign` de aynı kilidi alır, yarış serileşir.
      await assertKursunTabletMayWrite(tx, data.stepId, "açık kumaş açma");

      // DEPO: açık kumaş ÜRETİMDE doğar, bir depoda değil — ama kolon "en son
      // bulunduğu depo"yu taşır ve NULL bırakmak envanteri deliklendirir. Tek
      // depolu fabrikada zaten tek doğru cevap var; çok depolu ticaret kurulumu
      // bu yolu (fason dönüşü açık kumaş) hiç kullanmıyor.
      // EMANET: makbuzdan doğan top kaynak topların tek sahibini alır (fason kabulüyle aynı kalıtım, H10); sahipli
      // doğum emanet deposuna (fason kabulüyle aynı boğaz, F1b), sahipsiz bugünkü varsayılana.
      const openFabricOwnerId = await resolveOwnerFromReceiptTx(tx, receipt.id);
      const openFabricWarehouseId = await resolveBirthWarehouseIdTx(tx, null, openFabricOwnerId);
      // Top aşaması: adım söylemezse makbuz kaynak toplarının en düşük aşaması (üretim içi doğum).
      const sourceStages = await tx.subcontractorReceiptItem.findMany({ where: { receiptId: receipt.id }, select: { newRoll: { select: { stage: true } } } });
      const openFabricStage = stageForStepBirth(step.outputStage, lowestStage(sourceStages.map((i) => i.newRoll.stage)));
      const created = await tx.roll.create({
        data: {
          barcode: null,
          warehouseId: openFabricWarehouseId,
          clientToken: data.clientToken ?? null,
          itemId: fr.workOrder.targetItemId,
          colorId: receipt.appliedColorId,
          initialQty: 0,
          currentQty: 0,
          status: RollStatus.IN_PRODUCTION,
          // Açık kumaş (Tambur'dan geçmedi) → form ACIK.
          form: RollForm.ACIK,
          // Açık kumaş, kaliteye bakılmadı → qualityGrade null (Tambur karar verir).
          qualityGrade: null,
          qualityGradeId: null,
          entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
          stage: openFabricStage,
          createdById: userId ?? null,
          // GİRİŞ İSTASYONU — adım elde (Kurşun/KK2), kaynağı odur.
          entryStationId: resolveEntryStationId({ stepStationId: step.stationId }),
          currentStepId: step.id,
          producedInStepId: step.id,
          parentReceiptId: receipt.id,
          ownerCustomerId: openFabricOwnerId,
        },
      });

      if (propertyIds.length > 0) {
        await tx.rollProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            rollId: created.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // Kurşun/KK2 step'ine "girdi" — açık movement (ölçüm yok henüz; kursun-finish kapatır).
      await tx.rollMovement.create({
        data: {
          rollId: created.id,
          workOrderStepId: step.id,
          qtyIn: 0, // henüz ölçülmedi (Roll.initialQty = 0); kursun-finish'te qtyOut measured yazılır
          weightIn: null,
          operatorId: userId ?? null,
          notes: data.notes ?? `OPEN_FABRIC_FROM_RECEIPT:${receipt.receiptNo}`,
        },
      });

      await recomputeStepStatus(tx, step.id);
      await ensureWorkOrderInProgress(tx, receipt.workOrderId);

      return { fresh: true as const, roll: created };
    });
    if (!outcome.fresh) return outcome.replay;
    const roll = outcome.roll;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        rollKind: "OPEN_FABRIC",
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        workOrderId: receipt.workOrderId,
        stepId: step.id,
        appliedColorId: receipt.appliedColorId,
        appliedPropertyIds: propertyIds,
      },
    });

    return {
      success: true,
      data: roll,
      message: `Açık kumaş Roll oluşturuldu (id: ${roll.id}). Kurşun/KK2 sonrası kursun-finish endpoint'i ile metraj + hata girilir.`,
    };
  }
