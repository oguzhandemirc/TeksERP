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

import { ROLL_DISPLAY_ORDER } from "../constants/roll-order";
import { ACTIVE_OPERATION, revokeRollOperations } from "./helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT, revokeRollMovements } from "./helpers/roll-movement.helper";
import prisma from "../lib/prisma";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { Prisma, RollStatus, WorkOrderStatus, TravelerCardStatus, RollOperationType, StepStatus } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { createBatchTx, deleteIfEmptyAndTracelessTx, isBatchLockedTx, K18_DEAD_STATUSES } from "./batch.service";
import { recomputeStepStatus, ensureWorkOrderInProgress } from "./helpers/roll-step.helper";
import { reopenWorkOrderTx } from "./helpers/workorder-event.helper";
import { stepCanApplyColor } from "./helpers/step-capability.helper";
import { voidStalePendingBypassAssignmentsTx } from "./helpers/kursun-bypass-guard.helper";
import { setWorkOrderCardStatusesTx } from "./helpers/traveler-card-fanout.helper";
import { ApiResponse } from "../types/api.types";
import { OPEN_OUTSTANDING } from "./helpers/fason-open-dispatch.helper";
import { postProductionIssuesTx } from "./helpers/production-issue-ledger.helper";
import { hasRoll } from "./helpers/dispatch-item-kind.helper";

/**
 * Taşınabilir statüler — fasondaki/tüketilmiş/iptal/sevkli hariç (çuval/sevk ayrıca guard'lı).
 * EXPORT: Tambur saha düzeltmesi ("Mevcut Topu Buraya Al") aynı kümeye bakar —
 * elle kopyalanan ikinci bir liste, biri güncellenip diğeri unutulduğunda önizleme
 * ile uygulamanın SESSİZCE ayrışmasına yol açardı.
 */
export const MOVABLE_STATUSES: RollStatus[] = [RollStatus.IN_PRODUCTION, RollStatus.STOCK, RollStatus.WAREHOUSE];
/** Geri taşımada engelleyen işlemler — kesim/kalite kararı (fason logistiği hariç). */
const BLOCKING_OPS: RollOperationType[] = [
  RollOperationType.KURSUN_APPLIED,
  RollOperationType.QC2_COMPLETED,
  RollOperationType.TAMBUR_PROCESSED,
];

export type PartyMode = "keep" | "new" | "join";

/**
 * İş emrinin durumu manuel taşımayı ENGELLİYOR mu? (null = engel yok)
 *
 * İptal/devredilmiş WO ÖLÜ bir kayıttır: iptalde refakat kartları VOIDED olur ve
 * `ensureWorkOrderInProgress` yalnız PLANNED'ı diriltir → taşıma yapılsaydı top
 * canlı (IN_PRODUCTION) bir istasyonda kalır ama SAHA PERSONELİ DOKUNAMAZDI
 * (kart okutma "kart aktif değil", Tambur finalize "iptal/devredilmiş iş emrinin
 * topu finalize edilemez" ile reddeder) — tam bir çıkmaz. COMPLETED farklıdır:
 * manualMove onu bilinçli olarak IN_PROGRESS'e çekip kartı yeniden aktifleştirir.
 *
 * Topu gerçekten kullanmak için doğru yol: yeni bir iş emrine bağlamak.
 */
export function manualMoveWoBlockReason(status: WorkOrderStatus): string | null {
  if (status === WorkOrderStatus.CANCELLED) {
    return "İptal edilmiş iş emrinde konum düzeltilemez — top canlı kalır ama refakat kartı iptal olduğu için saha personeli okutamaz. Topu yeni bir iş emrine bağlayın.";
  }
  if (status === WorkOrderStatus.SUPERSEDED) {
    return "Devredilmiş iş emrinde konum düzeltilemez (malzemesi yeni iş emrine taşındı) — işlemi devam iş emrinde yapın.";
  }
  return null;
}

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
  /** Stok defteri: raftan üretime çıkış satırının deposu (claim ÖNCESİ). */
  warehouseId: string | null;
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
  /** İleri-atlama backflush renk sentezi için WO hedef rengi (boyahane atlanınca uygulanır). */
  woTargetColorId: string | null;
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

  /**
   * CUT hard-stop kümesi — YÖN-BİLİNÇLİ (2026-07-16): yalnız GERİ taşınan toplar
   * (kaynak adım hedeften SONRA, ya da adımsız — depo/stoktan üretime geri alma) için
   * ve yalnız çocuğun doğduğu kesim HEDEF-VEYA-SONRASI adımdaysa engeller. İLERİ
   * taşımada ve hedef-ÖNCESİ (tarihçe) kesimlerde çocuk varlığı engel DEĞİL — eski
   * yön-bağımsız `parentRollId` sayımı ileri-atlama backflush'ını başka yerde doğmuş
   * çocuklarla blokluyordu (kendi yorumu "hedef-sonrası kesim / geri taşınamaz" derken).
   * Doğum adımı bilinmeyen (producedInStepId null) çocuk muhafazakâr biçimde ENGELLER —
   * kesimin nerede yapıldığı kanıtlanamaz. Başka WO'nun adımında doğmuş çocuk (top
   * depodan yeni WO'ya alınmış) bu rotada tarihçedir — engel değil.
   */
  private async cutBlockedRollIds(
    db: Prisma.TransactionClient | typeof prisma,
    ctx: MoveContext,
  ): Promise<Set<string>> {
    const t = ctx.targetStep;
    const backwardIds = ctx.selected
      .filter((r) => {
        const seq = this.stepSeq(ctx.steps, r.currentStepId);
        return seq == null || seq > t.stepSequence;
      })
      .map((r) => r.id);
    if (backwardIds.length === 0) return new Set();
    const children = await db.roll.findMany({
      where: { parentRollId: { in: backwardIds } },
      select: { parentRollId: true, producedInStepId: true },
    });
    const targetOrLaterIds = new Set(
      ctx.steps.filter((s) => s.stepSequence >= t.stepSequence).map((s) => s.id),
    );
    return new Set(
      children
        .filter((c) => c.producedInStepId == null || targetOrLaterIds.has(c.producedInStepId))
        .map((c) => c.parentRollId)
        .filter((x): x is string => !!x),
    );
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
        targetColorId: true,
        steps: {
          orderBy: { stepSequence: "asc" },
          select: {
            id: true,
            stepSequence: true,
            station: { select: { name: true, type: true, appliesColor: true } },
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
      // TEK YÜKLEM (2026-08-21): istasyon bayrağı VEYA fason hizmeti — kilit
      // helper'ı ve Tambur "Boyahaneye Geri Gönder" ile aynı soru aynı cevap.
      // Eskiden yalnız kategoriye bakıyordu; iç boyahane tanımlansa sentez kaçardı.
      appliesColor: stepCanApplyColor(s.station, s.requiredCategory),
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
        warehouseId: true,
        batch: { select: { batchNumber: true, workOrderId: true } },
        currentStep: { select: { station: { select: { name: true } } } },
      },
      orderBy: ROLL_DISPLAY_ORDER,
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
      warehouseId: r.warehouseId,
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

    return { workOrderId, woStatus: wo.status, woTargetColorId: wo.targetColorId, steps, colorStep, targetStep, selected, isWholeParty, sourceBatchIds };
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

    // GERİ taşımada hedeften SONRA yapılmış işlem — İKİ tür:
    //   - CUT (fiziksel kesim → hedef-veya-sonrası adımda doğmuş parentRollId'li çocuk top):
    //     geri alınamaz → HARD-BLOCK (yön-bilinçli — bkz. cutBlockedRollIds).
    //   - Salt QC2/Kurşun (çocuk yok): kalite kararı geri alınabilir → top taşınır, kalite VOID
    //     edilir (grade → Belirsiz). Yanlış girilen grade/kurşun süpervizörün düzelttiği şeydir.
    const selIds = ctx.selected.map((r) => r.id);
    const opRows = await prisma.rollOperation.findMany({
      where: { ...ACTIVE_OPERATION, rollId: { in: selIds }, operationType: { in: BLOCKING_OPS }, step: { stepSequence: { gt: t.stepSequence } } },
      select: { rollId: true },
    });
    const opRollIds = new Set(opRows.map((o) => o.rollId));
    const cutBlocked = await this.cutBlockedRollIds(prisma, ctx);

    let anyQcVoid = false;
    const rolls = ctx.selected.map((r) => {
      let blockReason = this.moveBlockReason(r);
      if (!blockReason && cutBlocked.has(r.id)) {
        blockReason = "Hedef sonrası kesim yapılmış — kesim (çocuk) topları var, geri taşınamaz";
      }
      const qcWillVoid = !blockReason && opRollIds.has(r.id);
      if (qcWillVoid) anyQcVoid = true;
      return {
        id: r.id,
        barcode: r.barcode,
        batchNumber: r.batchNumber,
        currentStepId: r.currentStepId,
        currentStepName: r.currentStepName ?? (r.status === RollStatus.WAREHOUSE ? "Depo" : "—"),
        currentQty: Number(r.currentQty),
        movable: !blockReason,
        blockReason,
        qcWillVoid,
      };
    });

    const movable = rolls.filter((r) => r.movable);
    const warnings: string[] = [];

    // BACKFLUSH önizlemesi (ileri-atlama = Milestone). Atlanan ara adımlar SKIPPED olur,
    // renk-veren adım atlanınca renk WO hedef renginden UYGULANIR (eski "renk uygulanmaz"
    // davranışı kalktı), kalite Belirsiz kalır. Hedef renk yoksa taşıma engellenir.
    const minSourceSeq = Math.min(
      ...ctx.selected.map((r) => this.stepSeq(ctx.steps, r.currentStepId) ?? Number.POSITIVE_INFINITY),
    );
    const isForward = Number.isFinite(minSourceSeq) && t.stepSequence > minSourceSeq;
    const skippedStepNames = isForward
      ? ctx.steps
          .filter((s) => s.stepSequence > minSourceSeq && s.stepSequence < t.stepSequence)
          .map((s) => s.name ?? "Adım")
      : [];
    const colorSynthNeeded =
      ctx.colorStep != null &&
      t.stepSequence > ctx.colorStep.stepSequence &&
      ctx.selected.some((r) => r.colorId == null);
    // colorBlocked bir HARD-BLOCK (uyarı değil) → warnings'e değil backflush.colorBlocked'a;
    // frontend kırmızı blok + submit engeli olarak gösterir.
    const colorBlocked = colorSynthNeeded && !ctx.woTargetColorId;
    const backflush = {
      direction: (isForward ? "forward" : "backward") as "forward" | "backward",
      skippedStepNames,
      appliesColor: colorSynthNeeded && !colorBlocked,
      colorBlocked,
      qualityStaysUnknown: skippedStepNames.length > 0,
    };

    if (ctx.selected.some((r) => r.status === RollStatus.WAREHOUSE)) {
      warnings.push("Depodaki top üretime geri alınıyor.");
    }
    if (anyQcVoid) {
      warnings.push("Bazı topların hedef-sonrası kalite/kurşun kararı geri alınacak (grade → Belirsiz).");
    }
    if (ctx.woStatus === WorkOrderStatus.COMPLETED) {
      warnings.push("Tamamlanmış iş emri — taşıma ile yeniden açılacak (refakat kartı yeniden aktifleşir).");
    }
    // İptal/devredilmiş WO → HARD-BLOCK (uyarı değil). colorBlocked ile aynı sözleşme:
    // frontend kırmızı blok + submit engeli gösterir; manualMove ayrıca 409 atar.
    const woBlockReason = manualMoveWoBlockReason(ctx.woStatus);
    if (t.type === "EXTERNAL") {
      warnings.push("Fason adımına taşınıyor — mal orada üretimde bekler, sevki ayrıca (Fason Sevk) yapılır.");
      // YANLIŞ İŞ EMRİNE KABUL uyarısı: mal fiziksel olarak fasondayken kabul yanlış
      // WO'ya girilmişse doğru araç "Konumu Düzelt" DEĞİL, KABUL İPTALİ'dir — iptal
      // orijinal topları AT_SUBCONTRACTOR'a döndürür ve sevki yeniden açar (mal dışarıda
      // kalır). Manuel taşıma ise — tasarım gereği — topu fabrika İÇİNE (IN_PRODUCTION)
      // koyar; mal dışarıdayken bu envanteri yalanlar ve operatör tıkanır. Bu yüzden
      // HEDEF fason adımında iptal edilmemiş makbuz varsa önden söyle.
      // Kapsam hedef ADIMDIR (WO geneli değil): başka bir fason adımının makbuzunu iptal
      // etmek topları buraya döndürmez — o uyarı yanlış yere yönlendirirdi.
      // Tek findFirst — önizleme sık çağrılıyor; @@index([stepId]) kapsıyor.
      const openReceipt = await prisma.subcontractorReceipt.findFirst({
        where: { workOrderId, stepId: t.id, cancelledAt: null },
        select: { receiptNo: true },
        orderBy: { receivedAt: "desc" },
      });
      if (openReceipt) {
        warnings.push(
          `Bu iş emrinde kabul edilmiş bir makbuz var (${openReceipt.receiptNo}). Mal fiziksel olarak fasondaysa (yanlış iş emrine kabul yapıldıysa) "Konumu Düzelt" değil KABUL İPTALİ kullanın.`,
        );
      }
    }

    // KURŞUN BYPASS uyarısı: taşıma bir kurşun adımını BOŞALTIRSA (ya da ileri
    // atlamada o adımı atlarsa) adım recompute ile COMPLETED/SKIPPED'a düşer ve
    // `manualMove` sonundaki `voidStalePendingBypassAssignmentsTx` o adımın açık
    // dağıtımını iptal eder. Bu önizlemede söylenmezse dağıtımcı işi hâlâ kurşuna
    // verilmiş sanır ve Tambur'da okutmayı bekler — kimse bir şey okutmaz.
    // Uyarı kapsamı manualMove'un iptal kapsamıyla BİREBİR aynı mantığı taşır
    // (force YOK → yalnız terminale düşen adım).
    const pendingBypasses = await prisma.kursunBypassAssignment.findMany({
      where: { workOrderId, completedAt: null, cancelledAt: null },
      // Atama MAKİNE bazındadır (istasyon değil) — uyarıda dağıtımcının seçtiği
      // fiziksel kurşun makinesinin adı yazar, "Kurşun + KK2" gibi tek istasyon
      // adı değil (tek istasyon adı hangi işin iptal olduğunu ayırt ettirmezdi).
      select: { workOrderStepId: true, machine: { select: { name: true } } },
    });
    if (pendingBypasses.length > 0) {
      const movableIds = movable.map((r) => r.id);
      const forwardSkippedStepIds = new Set(
        isForward
          ? ctx.steps
              .filter((s) => s.stepSequence > minSourceSeq && s.stepSequence < t.stepSequence)
              .map((s) => s.id)
          : [],
      );
      for (const b of pendingBypasses) {
        // Hedefin KENDİSİ dağıtılmış adımsa mal oraya GİRİYOR → atama yaşar.
        if (b.workOrderStepId === t.id) continue;
        let willVoid = forwardSkippedStepIds.has(b.workOrderStepId);
        if (!willVoid && movable.some((r) => r.currentStepId === b.workOrderStepId)) {
          // Adımda taşınmayan üretim topu KALMIYORSA adım kapanır → atama iptal.
          // Kalıyorsa (kısmi taşıma) adım ACTIVE kalır ve dağıtım devam eder.
          const remaining = await prisma.roll.count({
            where: {
              currentStepId: b.workOrderStepId,
              id: { notIn: movableIds },
              status: {
                in: [
                  RollStatus.IN_PRODUCTION,
                  RollStatus.AT_SUBCONTRACTOR,
                  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
                ],
              },
            },
          });
          willVoid = remaining === 0;
        }
        if (willVoid) {
          warnings.push(`Kurşun dağıtımı iptal olacak — ${b.machine.name}`);
        }
      }
    }

    // 'join' adayları: aynı WO'da KİLİTSİZ + birleşmemiş (K17) diğer partiler.
    // K14 ÇİFT koşul INLINE (isBatchLockedTx ile aynı kural — sorgu-içi filtre
    // gerektiğinden kopya): kilitli = (a) AT_SUBCONTRACTOR topu VAR *veya*
    // (b) açık + OUTSTANDING (dönmemiş kalemi olan) sevki VAR. outstanding-scope
    // ŞART (K15 retarget dönmüş sevkleri partiye taşıyabilir) — dönmüş sevk
    // tarihçedir, kilit saymaz; eski `cancelledAt:null` filtresi dönmüş partiyi
    // sonsuza dek aday listesinden düşürürdü.
    const otherBatches = await prisma.batch.findMany({
      where: { workOrderId, id: { notIn: ctx.sourceBatchIds }, mergedIntoId: null },
      select: {
        id: true,
        batchNumber: true,
        rolls: { where: { status: RollStatus.AT_SUBCONTRACTOR }, select: { id: true }, take: 1 },
        dispatches: { where: OPEN_OUTSTANDING, select: { id: true }, take: 1 },
      },
      orderBy: { createdAt: "asc" },
    });
    const candidateJoinParties = otherBatches
      .filter((b) => b.rolls.length === 0 && b.dispatches.length === 0)
      .map((b) => ({ batchId: b.id, batchNumber: b.batchNumber }));

    // Fasondaki (AT_SUBCONTRACTOR) seçili toplar için AÇIK fason sevkleri — inline
    // "Sevki İptal Et" / "Fason Kabul" kısayolları için (ham teleport HARD-STOP; çıkmaz
    // banner yerine gerçek olay). Ham pointer-flip açık dispatch'i orphan ederdi.
    const fasonRollIds = ctx.selected
      .filter((r) => r.status === RollStatus.AT_SUBCONTRACTOR)
      .map((r) => r.id);
    const openDispatches =
      fasonRollIds.length > 0
        ? (
            await prisma.subcontractorDispatch.findMany({
              where: {
                cancelledAt: null,
                directShippedAt: null,
                items: { some: { rollId: { in: fasonRollIds } } },
              },
              select: {
                id: true,
                dispatchNo: true,
                stepId: true,
                subcontractorId: true,
                step: { select: { station: { select: { name: true } } } },
                // İnline Fason Kabul için: bu sevkin fasondaki topları (returns + newRolls prefill).
                items: {
                  where: { rollId: { in: fasonRollIds } },
                  select: { roll: { select: { id: true, barcode: true, currentQty: true } } },
                },
              },
            })
          ).map((d) => ({
            dispatchId: d.id,
            dispatchNo: d.dispatchNo,
            stepId: d.stepId,
            subcontractorId: d.subcontractorId,
            stepName: d.step?.station?.name ?? null,
            rolls: d.items.filter(hasRoll).map((it) => ({
              id: it.roll.id,
              barcode: it.roll.barcode,
              currentQty: Number(it.roll.currentQty),
            })),
          }))
        : [];

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
        openDispatches,
        backflush,
        warnings,
        /** true → iş emri ölü (iptal/devredilmiş); taşıma yapılamaz. */
        woBlocked: woBlockReason !== null,
        woBlockReason,
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
    // ÖLÜ WO GUARD'I: iptal/devredilmiş iş emrinde taşıma, topu "canlı ama kimsenin
    // dokunamadığı" çıkmaza sokar (kart VOIDED + istasyon guard'ları reddeder).
    // Tambur/Kurşun finalize guard'larıyla aynı gerekçe; tx-öncesi yeter (durum
    // geri diriltilemez — CANCELLED/SUPERSEDED terminaldir).
    const woBlock = manualMoveWoBlockReason(ctx.woStatus);
    if (woBlock) throw AppError.conflict(woBlock);

    const t = ctx.targetStep;
    const partyMode: PartyMode = input.partyMode ?? (ctx.isWholeParty ? "keep" : "new");

    // Backflush renk sentezi (Milestone): renk-veren adım (boyahane) atlanıp renksiz top
    // ileri gidiyorsa renk WO.targetColorId'den uygulanır. Hedef renk yoksa fail-fast —
    // asla sessiz renksiz bırakma. Kalite ASLA sentezlenmez (qualityGrade null kalır).
    const colorSynthNeeded =
      ctx.colorStep != null &&
      t.stepSequence > ctx.colorStep.stepSequence &&
      ctx.selected.some((r) => r.colorId == null);
    if (colorSynthNeeded && !ctx.woTargetColorId) {
      throw AppError.badRequest(
        "Bu iş emrinin hedef rengi yok — renk veren adım (boyahane) atlanamaz, renk sentezlenemez.",
      );
    }

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
        // ⚠️ 0) TX'İN İLK İŞİ (2026-08-29 / BULGU-T1-004): iş emri satırını
        //    KİLİTLE ve durumunu TAZE doğrula. `loadContext` statüyü tx DIŞINDA
        //    okuyor; planlamacı aynı anda iptal ederse taşıma İPTAL EDİLMİŞ iş
        //    emrinin adımına canlı top bırakır — bu dosyanın BİLEREK engellediği
        //    "canlı ama kimsenin okutamadığı top" çıkmazının ta kendisi
        //    (`manualMoveWoBlockReason` aynı kuralı tx dışında söylüyor; burası
        //    onun kilit altındaki ikizi).
        await touchWorkOrderTx(tx, workOrderId);
        const woFresh = await tx.workOrder.findUnique({
          where: { id: workOrderId },
          select: { status: true },
        });
        // WO silinmişse (olmamalı) taşımayı durdur — sessiz devam etmez.
        if (!woFresh) throw AppError.conflict("İş emri bu sırada kayboldu — listeyi yenileyin.");
        const tazeBlok = manualMoveWoBlockReason(woFresh.status);
        if (tazeBlok) {
          throw AppError.conflict(`${tazeBlok} — listeyi yenileyin.`, {
            code: "WORKORDER_TERMINAL_DURING_MOVE",
          });
        }

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

        // DEPO DEFTERİ — raftaki top üretime alınıyorsa mal raftan İNER (`attachRolls`
        // ile aynı yazıcı). Yön/metraj claim ÖNCESİ görüntüden (`ctx.selected`);
        // zaten üretimdeki top satır almaz. Yazılmadığı sürede raf topu üretime
        // satırsız giriyor, mutabakat onu "rafta" sayıyordu (ölçüldü 2026-09-13).
        await postProductionIssuesTx(tx, ctx.selected, { workOrderStepId: t.id, userId: userId ?? null });

        // Backflush renk sentezi — atlanan renk-veren adım için renksiz topları WO hedef
        // rengiyle boya (receive() emsali). Kalite ASLA sentezlenmez.
        let synthesizedColorId: string | null = null;
        let synthColorRollIds: string[] = [];
        if (colorSynthNeeded && ctx.woTargetColorId) {
          synthColorRollIds = ctx.selected.filter((r) => r.colorId == null).map((r) => r.id);
          if (synthColorRollIds.length > 0) {
            await tx.roll.updateMany({
              where: { id: { in: synthColorRollIds } },
              data: { colorId: ctx.woTargetColorId },
            });
            synthesizedColorId = ctx.woTargetColorId;
          }
        }

        // B2 → CUT hard-stop (yön-bilinçli): GERİ taşınan topta HEDEF-VEYA-SONRASI adımda
        //     doğmuş KESİM (fiziksel çocuk top) varsa geri taşınamaz (çocukları orphan eder).
        //     İleri taşımada / hedef-öncesi tarihçe kesiminde engel yok (cutBlockedRollIds).
        //     TOCTOU: ön-kontrol ile claim arasında yeni kesim girmiş olabilir → tx İÇİNDE.
        //     Salt QC2/Kurşun (çocuk yok) engel değil → VOID edilir.
        const cutBlockedNow = await this.cutBlockedRollIds(tx, ctx);
        if (cutBlockedNow.size > 0) {
          throw AppError.conflict(
            "Hedef sonrası kesim yapılmış — çocuk (kesim) topları var, geri taşınamaz. Önce kesimi geri alın.",
          );
        }

        // 2) Movement izi. Önce hedef-sonrası adımların movement'larını GERİ AL (B4: silinmez,
        //    damgalanır — op-block sayesinde orada iş yok), sonra kalan AKTİF açık movement'ı
        //    kapat, en son hedefte taze aç. recompute yalnız aktif movement'lardan türetir.
        if (laterStepIds.length > 0) {
          await revokeRollMovements(tx, {
            rollIds: selectedIds,
            workOrderStepIds: laterStepIds,
            reason: "MANUAL_MOVE",
            userId,
          });
        }
        // ⚠️ KAPANAN MOVEMENT `qtyOut`/`weightOut` YAZMAK ZORUNDA (2026-09-01).
        // Invariant: kapanmış movement'ta `qtyOut = qtyIn` (commit 64263fc) —
        // `scripts/consistency-check.sql §12` ve `test_consistency` onu ölçer.
        // Burası movement kapatan ALTI noktadan tek istisnaydı: yalnız `exitedAt`
        // yazıyordu, `qtyOut` NULL kalıyordu. Ölçüldü (canlı demo): "Konumu
        // Düzelt" ile taşınan 204,9 m'lik top §12'yi kırmızıya düşürdü. Bedeli
        // sessiz: `qtyOut` toplayan istasyon hacim/verim hesapları o topun
        // metrajını hiç görmez, hata da vermez.
        //
        // `updateMany` bir kolonu BAŞKA bir kolondan yazamaz (qtyOut = qtyIn),
        // o yüzden ham SQL. Zaman JS'ten BAĞLI PARAMETRE olarak geçer — `NOW()`
        // yazmak `test_raw_sql_hygiene` gerekçe işareti gerektirirdi ve burada
        // kazandıracağı bir şey yok.
        const cikisAni = new Date();
        await tx.$executeRaw`
          UPDATE "roll_movements"
             SET "exitedAt"  = ${cikisAni},
                 "qtyOut"    = "qtyIn",
                 "weightOut" = "weightIn",
                 "notes"     = 'MANUAL_MOVE_OUT'
           WHERE "rollId" = ANY(${selectedIds}::uuid[])
             AND "exitedAt" IS NULL
             AND "revokedAt" IS NULL`;
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

        // 2b) QC REVERSAL: hedef-sonrası salt QC2/Kurşun kararlarını VOID et — kesim yok
        //     (yukarıda hard-stop). BLOCKING_OPS izleri GERİ ALINIR (silinmez —
        //     defter doktrini) + kalite Belirsiz'e döner; top o adımı yeniden
        //     işleyince grade'i tekrar kazanır. Partial unique sayesinde geri
        //     alınmış satır dururken aynı üçlü yeniden yazılabilir.
        let qcVoided = false;
        if (laterStepIds.length > 0) {
          const revokedCount = await revokeRollOperations(tx, {
            rollIds: selectedIds,
            workOrderStepIds: laterStepIds,
            operationTypes: [...BLOCKING_OPS],
            reason: "MANUAL_MOVE_QC_VOID",
            userId,
          });
          if (revokedCount > 0) {
            await tx.roll.updateMany({
              where: { id: { in: selectedIds } },
              data: { qualityGrade: null },
            });
            qcVoided = true;
          }
        }

        // 3) Parti kararı.
        let newBatchNumber: string | null = null;
        const deletedSourceBatches: string[] = [];
        // K18: 'new'/'join' üyelik değiştirir — üyeliği GERÇEKTEN değişen CANLI
        // topların fiziksel etiketindeki Parti No bayatlar → yeniden bas uyarısı.
        // İlk atama (batchId=null; attach dalgası emsali) K18 kapsamı DIŞI —
        // etiket henüz parti numarasıyla basılmamıştır, bayraklanmaz. 'join'de
        // zaten hedef partide olan top da üyelik değiştirmez — bayraklanmaz.
        const flagLabelDirtyK18 = async (changedIds: string[]): Promise<void> => {
          if (changedIds.length === 0) return;
          await tx.roll.updateMany({
            where: { id: { in: changedIds }, status: { notIn: K18_DEAD_STATUSES } },
            data: { labelDirty: true },
          });
        };
        if (partyMode === "new") {
          const created = await createBatchTx(tx, {
            workOrderId,
            rollIds: selectedIds,
            splitFromId: ctx.sourceBatchIds.length === 1 ? ctx.sourceBatchIds[0] : null,
            userId,
          });
          newBatchNumber = created.batch.batchNumber;
          await flagLabelDirtyK18(
            ctx.selected.filter((r) => r.batchId !== null).map((r) => r.id),
          );
        } else if (partyMode === "join") {
          // B2: join hedefini tx İÇİNDE doğrula (kilit yarışı — ön-kontrol ile tx arasında
          //     hedef partiye fason sevki açılmış olabilir).
          // K14 çift-koşullu kilit (BORÇ-1): inline dispatch-sayımı yerine isBatchLockedTx —
          // AT_SUB top VEYA açık+outstanding sevk varsa kilitli; DÖNMÜŞ parti serbest
          // (K15 retarget dönmüş sevkleri partiye taşıyabilir — onlar kilit saymaz).
          // K17: birleşmiş parti tarihçe satırıdır — yeni üyelik alamaz.
          const jb = await tx.batch.findUnique({
            where: { id: input.joinBatchId! },
            select: {
              workOrderId: true,
              batchNumber: true,
              mergedIntoId: true,
              mergedInto: { select: { batchNumber: true } },
            },
          });
          if (!jb || jb.workOrderId !== workOrderId) {
            throw AppError.badRequest("Katılacak parti bu iş emrinde bulunamadı");
          }
          if (jb.mergedIntoId) {
            throw AppError.badRequest(
              `Parti ${jb.batchNumber}, ${jb.mergedInto?.batchNumber ?? jb.mergedIntoId} altına birleştirilmiş — işlem survivor partide yapılmalı`,
            );
          }
          if (await isBatchLockedTx(tx, input.joinBatchId!)) {
            throw AppError.conflict("Katılacak parti kilitli — fasonda malı/açık sevki var, katılamaz");
          }
          await tx.roll.updateMany({ where: { id: { in: selectedIds } }, data: { batchId: input.joinBatchId } });
          await flagLabelDirtyK18(
            ctx.selected
              .filter((r) => r.batchId !== null && r.batchId !== input.joinBatchId)
              .map((r) => r.id),
          );
        }
        // 'keep' → batchId'ye dokunma.

        // Kaynak partiler boşaldıysa (izsiz) sil (new/join'de olabilir).
        if (partyMode !== "keep") {
          for (const bid of ctx.sourceBatchIds) {
            if (await deleteIfEmptyAndTracelessTx(tx, bid)) deletedSourceBatches.push(bid);
          }
        }

        // 3b) BACKFLUSH SKIPPED: ileri-atlamada bypass edilen ara adımları — YALNIZ artık
        //     erişilemezlerse (atlanan set DIŞINDA o adıma muhtaç aktif üretim topu kalmadıysa)
        //     — SKIPPED damgala. recompute SKIPPED'e dokunmaz → jump'lanan toplar orada
        //     pendingRolls sayılmaz, WO tamamlanabilir. Emsal: subcontractor.service.ts:4701.
        const skippedStepIds: string[] = [];
        const minSourceSeq = Math.min(
          ...ctx.selected.map(
            (r) => this.stepSeq(ctx.steps, r.currentStepId) ?? Number.POSITIVE_INFINITY,
          ),
        );
        if (Number.isFinite(minSourceSeq) && t.stepSequence > minSourceSeq) {
          const intermediate = ctx.steps.filter(
            (s) => s.stepSequence > minSourceSeq && s.stepSequence < t.stepSequence,
          );
          for (const s of intermediate) {
            const stillNeeded = await tx.roll.count({
              where: {
                id: { notIn: selectedIds },
                status: {
                  in: [
                    RollStatus.IN_PRODUCTION,
                    RollStatus.AT_SUBCONTRACTOR,
                    RollStatus.RETURNED_FROM_SUBCONTRACTOR,
                  ],
                },
                movements: { some: { ...ACTIVE_MOVEMENT, step: { workOrderId } } },
                NOT: { movements: { some: { ...ACTIVE_MOVEMENT, workOrderStepId: s.id } } },
                currentStep: { stepSequence: { lte: s.stepSequence } },
              },
            });
            if (stillNeeded === 0) skippedStepIds.push(s.id);
          }
          if (skippedStepIds.length > 0) {
            await tx.workOrderStep.updateMany({
              where: {
                id: { in: skippedStepIds },
                status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] },
              },
              data: {
                status: StepStatus.SKIPPED,
                skipReason: `MANUAL_MOVE_BACKFLUSH: ${input.reason.trim().slice(0, 120)}`,
              },
            });
          }
        }

        // Geri-taşıma korkuluğu: hedefte VE sonrasında SKIPPED adım varsa (önceki ileri-atlamadan)
        // PENDING'e resetle — recompute SKIPPED'e dokunmaz, aksi halde top orada takılırdı.
        // İleri-atlama < target'ı SKIP eder, bu >= target'ı açar → çakışmaz.
        await tx.workOrderStep.updateMany({
          where: { workOrderId, stepSequence: { gte: t.stepSequence }, status: StepStatus.SKIPPED },
          data: { status: StepStatus.PENDING, skipReason: null },
        });

        // 4) Etkilenen adımları recompute (hedef + kaynak + geri alınan movement'lı sonraki adımlar)
        //    + WO'yu üretime çek. B1: WO COMPLETED ise topun statüsünden BAĞIMSIZ geri aç —
        //    top artık IN_PRODUCTION @ ACTIVE adım; kart flip olmazsa operatör okutamaz, kilitlenir.
        //    SKIPPED damgalanan ara adımları recompute'a SOKMA (recompute dokunmaz ama gereksiz).
        const affected = [...new Set<string>([t.id, ...sourceStepIds, ...laterStepIds])].filter(
          (id) => !skippedStepIds.includes(id),
        );
        for (const sid of affected) await recomputeStepStatus(tx, sid);
        await ensureWorkOrderInProgress(tx, workOrderId);
        let reopened = false;
        if (await reopenWorkOrderTx(tx, workOrderId, { trigger: "MANUAL_MOVE", userId })) {
          await setWorkOrderCardStatusesTx(tx, workOrderId, TravelerCardStatus.COMPLETED, TravelerCardStatus.ACTIVE);
          reopened = true;
        }

        // 5) Kurşun bypass: taşıma sonrası BAYAT kalan dağıtım atamalarını iptal et.
        //    `force` YOK — kapsamı adımın TAZE durumu belirlesin (bu yüzden recompute
        //    ve backflush SKIP damgasından SONRA çalışır):
        //      • adım COMPLETED/SKIPPED'a düştü (mal kurşundan tamamen çekildi ya da
        //        ileri-atlamada adım atlandı) → atama anlamsız, iptal.
        //      • adım ACTIVE/PENDING kaldı (kısmi taşıma, ya da GERİ taşımada mal
        //        kurşuna dönüyor) → atama YAŞAR; toplar geldiğinde bypass devam eder
        //        ve Tambur'da kart okutulunca normal şekilde kapanır.
        //    İSTASYON GERİ YÜKLENMEZ (helper sözleşmesi).
        const bypassVoided = await voidStalePendingBypassAssignmentsTx(
          tx,
          workOrderId,
          "MANUAL_MOVE",
        );

        return {
          newBatchNumber,
          deletedSourceBatches,
          reopened,
          skippedStepIds,
          synthesizedColorId,
          synthColorRollIds,
          qcVoided,
          bypassVoided,
        };
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
        // Backflush izi (Milestone atlama) — geri-alma + denetim için.
        backflush: result.skippedStepIds.length > 0 || result.synthesizedColorId != null,
        skippedStepIds: result.skippedStepIds,
        synthesizedColorId: result.synthesizedColorId,
        synthColorRollIds: result.synthColorRollIds,
        qcBypassed: result.skippedStepIds.length > 0,
        qcVoided: result.qcVoided,
        // Kurşun dağıtımı bu taşıma yüzünden iptal olduysa iz bırak — "işi kurşuna
        // dağıtmıştık, neden listede yok?" sorusunun cevabı burası.
        ...(result.bypassVoided > 0 ? { kursunBypassVoided: result.bypassVoided } : {}),
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
