// =============================================================================
// TeksERP — Manuel Konum Düzeltme (Süpervizör Override)
// =============================================================================
// Parti/top bazında rotada İLERİ veya GERİ manuel taşıma — DB'ye elle müdahale
// yerine panelden, kontrollü + izlenebilir. "Bu partiyi Kurşun'dan Tambur'a al" ya
// da "Tambur'dan Kurşun'a geri çek" gibi düzeltmeler.
//
// Manuel taşıma bir DÜZELTMEDİR, üretim olayı değil → lot kimliği korunur, farklı
// lotlar sessizce birleşmez (kimlik değişimi hep explicit + splitFrom izli).
//   - Tüm parti taşınırsa: P-no korunur (oto-merge YOK).
//   - Kısmi taşınırsa: partyMode ile → 'new' (yeni P, splitFrom) | 'join' (hedef
//     partiye kat) | 'keep' (parti iki konuma yayılır).
//
// Guard'lar: fasondaki(AT_SUBCONTRACTOR)/sevkli/çuvaldaki/tüketilmiş top taşınamaz;
// hedef adım aynı WO rotasında; GERİ taşımada hedeften SONRA yapılmış işlem
// (Kurşun/QC2/Tambur kesim) varsa ENGELLE; atomik claim; sebep + önizleme zorunlu.
// İzin: workorder:write. Migration YOK — mevcut alanlar. Mekanik emsali:
// workorder-split.service.ts (redye rewind + repoint + recompute).
// =============================================================================

import prisma from "../lib/prisma";
import { Prisma, RollStatus, WorkOrderStatus, TravelerCardStatus, RollOperationType } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { createBatchTx, deleteIfEmptyAndTraceless } from "./batch.service";
import { recomputeStepStatus, ensureWorkOrderInProgress } from "./helpers/roll-step.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
import { ApiResponse } from "../types/api.types";

/** Taşınabilir statüler — fasondaki/tüketilmiş/iptal/sevkli hariç (çuval/sevk ayrıca guard'lı). */
const MOVABLE_STATUSES: RollStatus[] = [RollStatus.IN_PRODUCTION, RollStatus.STOCK, RollStatus.WAREHOUSE];
/** Geri taşımada engelleyen işlemler — kesim/kalite kararı (fason logistiği hariç). */
const BLOCKING_OPS: RollOperationType[] = [
  RollOperationType.KURSUN_APPLIED,
  RollOperationType.QC2_COMPLETED,
  RollOperationType.TAMBUR_PROCESSED,
];

export type PartyMode = "keep" | "new" | "join";

interface MoveRoll {
  id: string;
  barcode: string | null;
  status: RollStatus;
  currentStepId: string | null;
  currentQty: Prisma.Decimal;
  weightKg: Prisma.Decimal | null;
  colorId: string | null;
  sackId: string | null;
  shipmentId: string | null;
  batchId: string | null;
  batchNumber: string | null;
  currentStepName: string | null;
}

interface StepRef {
  id: string;
  stepSequence: number;
  name: string | null;
  type: string | null;
  appliesColor: boolean;
}

interface MoveContext {
  workOrderId: string;
  woStatus: WorkOrderStatus;
  steps: StepRef[];
  colorStep: StepRef | null;
  targetStep: StepRef;
  selected: MoveRoll[];
  /** Seçim tek partinin TÜM canlı topları mı (→ kimlik korunur). */
  isWholeParty: boolean;
  sourceBatchIds: string[];
}

export class WorkOrderManualMoveService {
  private stepSeq(steps: StepRef[], stepId: string | null): number | null {
    if (!stepId) return null;
    return steps.find((s) => s.id === stepId)?.stepSequence ?? null;
  }

  /** Ortak bağlam: WO adımları, hedef adım, seçili toplar + hangileri gerçekten taşınabilir. */
  private async loadContext(
    workOrderId: string,
    input: { batchId?: string; rollIds?: string[]; targetStepId: string },
  ): Promise<MoveContext> {
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
            station: { select: { name: true, type: true } },
            requiredCategory: { select: { appliesColor: true } },
          },
        },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const steps: StepRef[] = wo.steps.map((s) => ({
      id: s.id,
      stepSequence: s.stepSequence,
      name: s.station?.name ?? null,
      type: s.station?.type ?? null,
      appliesColor: Boolean(s.requiredCategory?.appliesColor),
    }));
    const targetStep = steps.find((s) => s.id === input.targetStepId);
    if (!targetStep) throw AppError.badRequest("Hedef adım bu iş emrinin rotasında değil");
    const colorStep = steps.find((s) => s.appliesColor) ?? null;

    // Seçili topları çöz: rollIds verildiyse onlar; yoksa batchId'nin canlı topları.
    const rollWhere: Prisma.RollWhereInput =
      input.rollIds && input.rollIds.length > 0
        ? { id: { in: input.rollIds } }
        : { batchId: input.batchId };
    const rolls = await prisma.roll.findMany({
      where: {
        ...rollWhere,
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
        barcode: true,
        status: true,
        currentStepId: true,
        currentQty: true,
        weightKg: true,
        colorId: true,
        sackId: true,
        shipmentId: true,
        batchId: true,
        batch: { select: { batchNumber: true, workOrderId: true } },
        currentStep: { select: { station: { select: { name: true } } } },
      },
      orderBy: [{ barcode: "asc" }, { createdAt: "asc" }],
    });

    // Cross-WO koruması: her top bu WO'ya ait olmalı.
    for (const r of rolls) {
      if (r.batch && r.batch.workOrderId !== workOrderId) {
        throw AppError.badRequest("Seçilen toplardan biri başka iş emrine ait");
      }
    }

    const selected: MoveRoll[] = rolls.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      currentStepId: r.currentStepId,
      currentQty: r.currentQty,
      weightKg: r.weightKg,
      colorId: r.colorId,
      sackId: r.sackId,
      shipmentId: r.shipmentId,
      batchId: r.batchId,
      batchNumber: r.batch?.batchNumber ?? null,
      currentStepName: r.currentStep?.station?.name ?? null,
    }));

    // Tek partinin TÜM canlı topları mı? (rollIds verilmeden batchId ile → evet.)
    const sourceBatchIds = [...new Set(selected.map((r) => r.batchId).filter((x): x is string => !!x))];
    let isWholeParty = false;
    if (!input.rollIds || input.rollIds.length === 0) {
      isWholeParty = true;
    } else if (sourceBatchIds.length === 1) {
      const total = await prisma.roll.count({
        where: {
          batchId: sourceBatchIds[0],
          status: {
            notIn: [
              RollStatus.SUBCONTRACTOR_CONSUMED,
              RollStatus.TAMBUR_CONSUMED,
              RollStatus.CANCELLED,
              RollStatus.SHIPPED,
            ],
          },
        },
      });
      isWholeParty = selected.length === total;
    }

    return { workOrderId, woStatus: wo.status, steps, colorStep, targetStep, selected, isWholeParty, sourceBatchIds };
  }

  /** Bir topun taşınamama nedeni (null = taşınabilir). Downstream işlem kontrolü ayrı. */
  private moveBlockReason(r: MoveRoll): string | null {
    if (r.status === RollStatus.AT_SUBCONTRACTOR) return "Fasonda (dışarıda) — önce Fason Kabul / sevk iptali";
    if (r.sackId) return "Çuvalda — önce çuvaldan çıkarın";
    if (r.shipmentId) return "Sevkiyata atanmış — önce sevkten çıkarın";
    if (!MOVABLE_STATUSES.includes(r.status)) return "Bu durumdaki top taşınamaz";
    return null;
  }

  /** Önizleme — hiçbir şeyi değiştirmez. Taşınabilir/engelli toplar + parti kararı + uyarılar. */
  async getManualMovePreview(
    workOrderId: string,
    input: { batchId?: string; rollIds?: string[]; targetStepId: string },
  ): Promise<ApiResponse<unknown>> {
    const ctx = await this.loadContext(workOrderId, input);
    const t = ctx.targetStep;

    // GERİ taşımada hedeften SONRA yapılmış kesim/kalite işlemi olan toplar.
    const opRows = await prisma.rollOperation.findMany({
      where: {
        rollId: { in: ctx.selected.map((r) => r.id) },
        operationType: { in: BLOCKING_OPS },
        step: { stepSequence: { gt: t.stepSequence } },
      },
      select: { rollId: true },
    });
    const opBlocked = new Set(opRows.map((o) => o.rollId));

    const rolls = ctx.selected.map((r) => {
      let blockReason = this.moveBlockReason(r);
      if (!blockReason && opBlocked.has(r.id)) {
        blockReason = "Hedef sonrası kesim/kalite işlemi yapılmış — önce o işlemi geri alın";
      }
      return {
        id: r.id,
        barcode: r.barcode,
        batchNumber: r.batchNumber,
        currentStepId: r.currentStepId,
        currentStepName: r.currentStepName ?? (r.status === RollStatus.WAREHOUSE ? "Depo" : "—"),
        currentQty: Number(r.currentQty),
        movable: !blockReason,
        blockReason,
      };
    });

    const movable = rolls.filter((r) => r.movable);
    const warnings: string[] = [];
    if (ctx.colorStep && t.stepSequence > ctx.colorStep.stepSequence && ctx.selected.some((r) => r.colorId == null)) {
      warnings.push("Renk veren adım sonrasına taşınıyor ama bazı toplar renksiz — manuel taşımada renk uygulanmaz.");
    }
    if (ctx.selected.some((r) => r.status === RollStatus.WAREHOUSE)) {
      warnings.push("Depodaki top üretime geri alınıyor.");
    }
    if (ctx.woStatus === WorkOrderStatus.COMPLETED) {
      warnings.push("Tamamlanmış iş emri — taşıma ile yeniden açılacak (refakat kartı yeniden aktifleşir).");
    }
    if (t.type === "EXTERNAL") {
      warnings.push("Fason adımına taşınıyor — mal orada üretimde bekler, sevki ayrıca (Fason Sevk) yapılır.");
    }

    // 'join' adayları: aynı WO'da sevksiz (kilitsiz) diğer partiler.
    const otherBatches = await prisma.batch.findMany({
      where: { workOrderId, id: { notIn: ctx.sourceBatchIds } },
      select: { id: true, batchNumber: true, dispatches: { where: { cancelledAt: null }, select: { id: true } } },
      orderBy: { createdAt: "asc" },
    });
    const candidateJoinParties = otherBatches
      .filter((b) => b.dispatches.length === 0)
      .map((b) => ({ batchId: b.id, batchNumber: b.batchNumber }));

    return {
      success: true,
      data: {
        targetStep: { id: t.id, stepSequence: t.stepSequence, name: t.name, type: t.type },
        isWholeParty: ctx.isWholeParty,
        partyDecisionNeeded: !ctx.isWholeParty,
        rolls,
        movableCount: movable.length,
        blockedCount: rolls.length - movable.length,
        candidateJoinParties,
        warnings,
      },
    };
  }

  /** Manuel taşımayı uygula. */
  async manualMove(
    workOrderId: string,
    input: {
      batchId?: string;
      rollIds?: string[];
      targetStepId: string;
      partyMode?: PartyMode;
      joinBatchId?: string;
      reason: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    if (!input.reason || input.reason.trim().length < 3) {
      throw AppError.badRequest("Taşıma gerekçesi zorunlu (en az 3 karakter)");
    }
    const ctx = await this.loadContext(workOrderId, input);
    const t = ctx.targetStep;
    const partyMode: PartyMode = input.partyMode ?? (ctx.isWholeParty ? "keep" : "new");

    // B3: istenen topların bir kısmı terminal statüde (sevkli/tüketilmiş/iptal) olduğu için
    // çözülemediyse SESSİZCE daha az taşıma yapma — somut sayı paritesi (yıkıcı-onay ilkesi).
    if (input.rollIds && input.rollIds.length > 0 && ctx.selected.length !== input.rollIds.length) {
      throw AppError.badRequest(
        "Seçilen toplardan bazıları artık taşınmaya uygun değil (sevkli/tüketilmiş/iptal) — önizlemeyi yenileyin.",
      );
    }

    // Taşınamaz top var mı? (statü/çuval/sevk)
    const blocked = ctx.selected.filter((r) => this.moveBlockReason(r));
    if (blocked.length > 0) {
      throw AppError.badRequest(
        `Seçili ${blocked.length} top taşınamaz (fasonda/çuvalda/sevkli). Önizlemeyi yenileyin.`,
      );
    }
    const selectedIds = ctx.selected.map((r) => r.id);
    if (selectedIds.length === 0) throw AppError.badRequest("Taşınacak top yok");

    // B5: hedef = mevcut adım (tüm toplar zaten orada) → no-op; kirli iz/parti churn bırakma.
    if (ctx.selected.every((r) => r.currentStepId === t.id)) {
      throw AppError.badRequest("Toplar zaten bu adımda — taşıma gerekmez.");
    }

    if (partyMode === "join" && !input.joinBatchId) {
      throw AppError.badRequest("Katılacak parti seçilmedi");
    }

    const sourceStepIds = [...new Set(ctx.selected.map((r) => r.currentStepId).filter((x): x is string => !!x))];
    // Geri taşımada hedeften SONRAKİ adımların konum izini geri al (op-block sayesinde
    // oralarda kesim/kalite işlemi YOK — yalnız movement). Aksi halde kapalı "hayalet"
    // movement o adımı yanlış COMPLETED gösterir (B4). İleri taşımada bu küme boş.
    const laterStepIds = ctx.steps.filter((s) => s.stepSequence > t.stepSequence).map((s) => s.id);

    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // 1) ATOMİK CLAIM — hedef adıma taşı, IN_PRODUCTION yap (fason adımı da awaiting).
        //    Movability invariant'ları where'de → arada değişirse count uyuşmaz → 409.
        const claim = await tx.roll.updateMany({
          where: {
            id: { in: selectedIds },
            status: { in: MOVABLE_STATUSES },
            sackId: null,
            shipmentId: null,
          },
          data: { currentStepId: t.id, status: RollStatus.IN_PRODUCTION },
        });
        if (claim.count !== selectedIds.length) {
          throw AppError.conflict("Toplar bu sırada değişti — taşıma iptal, önizlemeyi yenileyin.");
        }

        // B2: GERİ taşıma işlem engeli — tx İÇİNDE, claim'den SONRA (TOCTOU: ön-kontrol ile
        //     claim arasında yeni bir kesim/kalite işlemi girmiş olabilir).
        const opBlocked = await tx.rollOperation.count({
          where: {
            rollId: { in: selectedIds },
            operationType: { in: BLOCKING_OPS },
            step: { stepSequence: { gt: t.stepSequence } },
          },
        });
        if (opBlocked > 0) {
          throw AppError.conflict(
            "Hedef adımdan sonra kesim/kalite işlemi yapılmış top var — önce o işlemi geri alın, sonra taşıyın.",
          );
        }

        // 2) Movement izi. Önce hedef-sonrası adımların movement'larını SİL (B4: konum izini
        //    geri al — op-block sayesinde orada iş yok), sonra kalan açık movement'ı kapat,
        //    en son hedefte taze aç. recompute bu movement'lardan status türetir.
        if (laterStepIds.length > 0) {
          await tx.rollMovement.deleteMany({
            where: { rollId: { in: selectedIds }, workOrderStepId: { in: laterStepIds } },
          });
        }
        await tx.rollMovement.updateMany({
          where: { rollId: { in: selectedIds }, exitedAt: null },
          data: { exitedAt: new Date(), notes: "MANUAL_MOVE_OUT" },
        });
        await tx.rollMovement.createMany({
          data: ctx.selected.map((r) => ({
            rollId: r.id,
            workOrderStepId: t.id,
            qtyIn: r.currentQty,
            weightIn: r.weightKg ?? null,
            operatorId: userId ?? null,
            notes: "MANUAL_MOVE_IN",
          })),
        });

        // 3) Parti kararı.
        let newBatchNumber: string | null = null;
        const deletedSourceBatches: string[] = [];
        if (partyMode === "new") {
          const created = await createBatchTx(tx, {
            workOrderId,
            rollIds: selectedIds,
            splitFromId: ctx.sourceBatchIds.length === 1 ? ctx.sourceBatchIds[0] : null,
            userId,
          });
          newBatchNumber = created.batch.batchNumber;
        } else if (partyMode === "join") {
          // B2: join hedefini tx İÇİNDE doğrula (kilit yarışı — ön-kontrol ile tx arasında
          //     hedef partiye fason sevki açılmış olabilir).
          const jb = await tx.batch.findUnique({
            where: { id: input.joinBatchId! },
            select: { workOrderId: true, dispatches: { where: { cancelledAt: null }, select: { id: true } } },
          });
          if (!jb || jb.workOrderId !== workOrderId) {
            throw AppError.badRequest("Katılacak parti bu iş emrinde bulunamadı");
          }
          if (jb.dispatches.length > 0) throw AppError.conflict("Katılacak parti sevkte — kilitli, katılamaz");
          await tx.roll.updateMany({ where: { id: { in: selectedIds } }, data: { batchId: input.joinBatchId } });
        }
        // 'keep' → batchId'ye dokunma.

        // Kaynak partiler boşaldıysa (izsiz) sil (new/join'de olabilir).
        if (partyMode !== "keep") {
          for (const bid of ctx.sourceBatchIds) {
            if (await deleteIfEmptyAndTraceless(tx, bid)) deletedSourceBatches.push(bid);
          }
        }

        // 4) Etkilenen adımları recompute (hedef + kaynak + silinen movement'lı sonraki adımlar)
        //    + WO'yu üretime çek. B1: WO COMPLETED ise topun statüsünden BAĞIMSIZ geri aç —
        //    top artık IN_PRODUCTION @ ACTIVE adım; kart flip olmazsa operatör okutamaz, kilitlenir.
        const affected = [...new Set<string>([t.id, ...sourceStepIds, ...laterStepIds])];
        for (const sid of affected) await recomputeStepStatus(tx, sid);
        await ensureWorkOrderInProgress(tx, workOrderId);
        let reopened = false;
        const res = await tx.workOrder.updateMany({
          where: { id: workOrderId, status: WorkOrderStatus.COMPLETED },
          data: { status: WorkOrderStatus.IN_PROGRESS },
        });
        if (res.count > 0) {
          await setWorkOrderCardStatuses(tx, workOrderId, TravelerCardStatus.COMPLETED, TravelerCardStatus.ACTIVE);
          reopened = true;
        }

        return { newBatchNumber, deletedSourceBatches, reopened };
      }),
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: selectedIds[0],
      newData: {
        event: "MANUAL_MOVE",
        workOrderId,
        targetStepId: t.id,
        targetStepName: t.name,
        rollIds: selectedIds,
        rollCount: selectedIds.length,
        partyMode,
        joinBatchId: partyMode === "join" ? input.joinBatchId : null,
        newBatchNumber: result.newBatchNumber,
        reason: input.reason.trim(),
        reopened: result.reopened,
      },
    });

    return {
      success: true,
      data: {
        movedRollCount: selectedIds.length,
        targetStepName: t.name,
        partyMode,
        newBatchNumber: result.newBatchNumber,
        reopened: result.reopened,
      },
      message: `${selectedIds.length} top "${t.name}" adımına taşındı${
        result.newBatchNumber ? ` (yeni parti ${result.newBatchNumber})` : ""
      }.`,
    };
  }
}
