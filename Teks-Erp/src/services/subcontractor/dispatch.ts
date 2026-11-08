// =============================================================================
// TeksERP - Subcontractor (Fason) Service / dispatch
// =============================================================================
// Fason sevk: sevk, toplu adım sevki, ardışık fasona aktarma, erken taslak çeki, talimat güncelleme.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { ROLL_DISPLAY_ORDER } from "../../constants/roll-order";
import { ACTIVE_TARGET_PROPERTY } from "../helpers/property-revoke.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { sackBlockMessage } from "../helpers/sack-invariants.helper";
import { postStockMoves } from "../helpers/warehouse-ledger.helper";
import { assertRollsHaveWarehouse, WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { ApiResponse } from "../../types/api.types";
import {
  assertBatchInWorkOrderTx,
  createBatchTx,
  deleteIfEmptyAndTracelessTx,
  K18_DEAD_STATUSES,
  type CreateBatchResult,
} from "../batch.service";
import { Prisma, PrintedDocType, RollOperationType, RollStatus, StationType, StepStatus, TravelerCardStatus, WorkOrderStatus, ScanType, WarehouseEventType } from "@prisma/client";
import { printedDocumentService } from "../printed-document.service";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { dispatchWarpBeamItemsTx } from "../subcontractor-beam.service";
import { dispatchYarnItemsTx, type YarnDispatchLineInput } from "../subcontractor-yarn.service";
import { ensureWorkOrderInProgress } from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { resolveStepWorkInstructions, resolveStepDyeColor } from "../helpers/fason-work-instructions.helper";
import { OPEN_OUTSTANDING } from "../helpers/fason-open-dispatch.helper";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { uyari } from "../../lib/logger";
import { TERIM } from "../../constants/terim";
import { nextSubcontractorDocNoTx } from "./shared";
import { assembleFasonCekiDoc } from "./printed-docs";
import type { SubcontractorServiceThis } from "./shared";

export async function dispatch(
    data: {
      workOrderId: string;
      stepId: string;
      subcontractorId: string;
      rollIds: string[];
      plateNumber?: string;
      driverName?: string;
      notes?: string;
      /** Fason talimatı — genel sevk notundan (notes) ayrı. Boşsa adımın notu kullanılır. */
      instruction?: string;
      /**
       * Operatör WO ürünü ile uyuşmayan top sevkini bilinçli olarak onayladı.
       * Frontend mismatch modal'ında onayladıktan sonra true gönderir.
       * Bu durumda mismatch warning audit'e ITEM_MISMATCH_OVERRIDE olarak
       * yazılır, sevk normal işler.
       */
      allowItemOverride?: boolean;
      /**
       * Operatör rota sırasını atlayan sevki (ör. zımpara atlanıp doğrudan
       * boyahaneye) bilinçli onayladı. Frontend ROUTE_SKIP uyarı modalında
       * onaylayınca true gönderir; audit'e routeSkipOverride yazılır.
       */
      allowRouteSkip?: boolean;
      /**
       * K11: seçilen toplar 2+ partiye yayılıyorsa çözüm stratejisi. 'MERGE' = en eski
       * partide birleştir (diğer kartlar VOID); 'SEPARATE' = parti başına ayrı sevk, HEPSİ
       * TEK tx'te (ya hep ya hiç, D8 R5a); verilmezse 409 MULTI_BATCH (eski istemci aynı yanıtı alır).
       */
      multiBatchStrategy?: "MERGE" | "SEPARATE";
      /**
       * F1: fasona verilen LEVENTLER (kalem `kind=WARP_BEAM`, `SHIP_OUT` aynı tx). Top listesinden
       * bağımsız — levent-yalnız sevk meşrudur (parti boş doğar). Kapı: devere kapalıysa controller 403.
       */
      warpBeamIds?: string[];
      /**
       * G1: fasona verilen İPLİK satırları (kalem `kind=YARN`, `SUBCONTRACT_OUT` aynı tx). Top ve leventten
       * bağımsız — iplik-yalnız sevk meşrudur. Kapı: iplik kapalıysa controller 403 + tek yazıcı 403.
       */
      yarnLines?: YarnDispatchLineInput[];
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const warpBeamIds = [...new Set(data.warpBeamIds ?? [])];
    const yarnLines = data.yarnLines ?? [];
    if ((!data.rollIds || data.rollIds.length === 0) && warpBeamIds.length === 0 && yarnLines.length === 0) {
      throw AppError.badRequest("En az bir top seçmelisiniz");
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
    });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (
      wo.status !== WorkOrderStatus.PLANNED &&
      wo.status !== WorkOrderStatus.IN_PROGRESS
    ) {
      throw AppError.conflict(
        `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} sevk yapılamaz: ${wo.status}. Sadece PLANNED/IN_PROGRESS.`
      );
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: { name: true, code: true, type: true } },
        workOrder: true,
        requiredCategory: { select: { id: true, name: true } },
      },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        `Sevk yalnızca EXTERNAL (fason/boyahane) istasyonlar için yapılabilir. Mevcut: ${step.station.type}`
      );
    }
    // SKIPPED adım rotadan bilinçli çıkarılmış — sevk yapılamaz. COMPLETED adıma
    // ise EK PARTİ sevki yapılabilir (çoklu sevk): aşağıdaki transaction adımı
    // tekrar ACTIVE'e açar. Tek kısıt WO statüsü (yukarıda) — COMPLETED/CANCELLED
    // iş emrine sevk yok.
    if (step.status === StepStatus.SKIPPED) {
      throw AppError.conflict(
        `Adım atlanmış (SKIPPED). Sevk yapılamaz.`
      );
    }

    // ÇOKLU SEVK: Aynı adıma paralel birden çok açık sevke izin verilir —
    // boyahaneye kumaş parça parça gönderilebilir. Aynı topun iki kez
    // gönderilmesi aşağıdaki per-roll status (AT_SUBCONTRACTOR) kontrolüyle
    // zaten engellenir; ayrıca bir "tek açık sevk" kısıtı yoktur.
    //
    // IDEMPOTENCY: Offline sync replay'de aynı çağrı (AYNI rollIds + AYNI fason)
    // tekrar gelirse, o açık sevki cached döndür — yeni kayıt açma. Farklı
    // toplar = meşru yeni parti → guard geçer, yeni sevk açılır.
    const incomingRollIds = new Set(data.rollIds);
    const incomingBeamIds = new Set(warpBeamIds);
    const openDispatches = await prisma.subcontractorDispatch.findMany({
      // Açık+outstanding tanımı TEK KAYNAKTAN (doğrudan-sevk edilmiş sevk "açık" sayılmaz).
      where: { stepId: data.stepId, ...OPEN_OUTSTANDING },
      select: {
        id: true,
        dispatchNo: true,
        subcontractorId: true,
        items: { select: { rollId: true, warpBeamId: true } },
      },
    });
    for (const open of openDispatches) {
      const existingRollIds = new Set(open.items.map((i) => i.rollId).filter((x): x is string => !!x));
      const existingBeamIds = new Set(open.items.map((i) => i.warpBeamId).filter((x): x is string => !!x));
      const sameRolls =
        existingRollIds.size === incomingRollIds.size &&
        [...existingRollIds].every((id) => incomingRollIds.has(id)) &&
        existingBeamIds.size === incomingBeamIds.size &&
        [...existingBeamIds].every((id) => incomingBeamIds.has(id));
      if (sameRolls && open.subcontractorId === data.subcontractorId) {
        return {
          success: true,
          data: open,
          message: `Fason sevki zaten oluşturulmuş (idempotent retry): ${open.dispatchNo}`,
        };
      }
    }
    // SEPARATE tekrarı: seçim, bu firmanın açık sevklerine TAM bölünmüşse o sevkler döner.
    if (data.multiBatchStrategy === "SEPARATE" && incomingBeamIds.size === 0 && incomingRollIds.size > 0) {
      const mine = openDispatches.filter((o) => o.subcontractorId === data.subcontractorId && o.items.length > 0
        && o.items.every((i) => !!i.rollId && incomingRollIds.has(i.rollId)));
      const covered = new Set(mine.flatMap((o) => o.items.map((i) => i.rollId)));
      if (mine.length > 1 && covered.size === incomingRollIds.size) {
        return {
          success: true,
          data: { separate: true, dispatchCount: mine.length, dispatches: mine },
          message: `Fason sevkleri zaten oluşturulmuş (idempotent retry): ${mine.map((o) => o.dispatchNo).join(", ")}`,
        };
      }
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
      select: { id: true, isActive: true },
    });
    if (!subcontractor) throw AppError.notFound("Fason firma bulunamadı");
    // Soft-delete guard: pasife alınmış firmaya yeni sevk açılamaz.
    if (!subcontractor.isActive) throw AppError.badRequest("Fason firma pasif durumda");

    // Adımın hizmet kategorisi tanımlıysa, seçilen fason firmanın bu kategoride
    // hizmet veriyor olması zorunlu (SubcontractorToCategory eşleşmesi).
    if (step.requiredCategoryId) {
      const link = await prisma.subcontractorToCategory.findUnique({
        where: {
          subcontractorId_categoryId: {
            subcontractorId: data.subcontractorId,
            categoryId: step.requiredCategoryId,
          },
        },
        select: { categoryId: true },
      });
      if (!link) {
        const categoryName =
          step.requiredCategory?.name ?? step.requiredCategoryId;
        throw AppError.badRequest(
          `Bu fason firma bu kategoride hizmet vermiyor (gerekli: ${categoryName}).`
        );
      }
    }

    const rolls = await prisma.roll.findMany({
      where: { id: { in: data.rollIds } },
    });
    if (rolls.length !== data.rollIds.length) {
      const foundIds = new Set(rolls.map((r) => r.id));
      const missing = data.rollIds.filter((id) => !foundIds.has(id));
      throw AppError.notFound(`Top bulunamadı: ${missing.join(", ")}`);
    }

    // Item mismatch kontrolü: WO.targetItemId varsa, tüm seçilen rulolar bu
    // ürünle eşleşmeli. Uyuşmazsa: allowItemOverride=true ise warning + audit
    // ile devam; yoksa hata fırlat (frontend modal'da onaya gönderir).
    // wo.targetItemId null olabilir (stok üretim için targetItem zorunlu değil) —
    // o durumda check atlanır.
    if (wo.targetItemId) {
      const mismatchedRolls = rolls.filter((r) => r.itemId !== wo.targetItemId);
      if (mismatchedRolls.length > 0) {
        // İsimleri client'a göstermek için bir kez çek
        const itemIdSet = new Set<string>([
          wo.targetItemId,
          ...mismatchedRolls.map((r) => r.itemId),
        ]);
        const items = await prisma.item.findMany({
          where: { id: { in: [...itemIdSet] } },
          select: { id: true, code: true, name: true },
        });
        const itemMap = new Map(
          items.map((i) => [i.id, { code: i.code, name: i.name }] as const),
        );
        const expected = itemMap.get(wo.targetItemId);
        const expectedLabel = expected
          ? `${expected.code} - ${expected.name}`
          : wo.targetItemId;

        if (!data.allowItemOverride) {
          throw AppError.badRequest(
            `${TERIM.terbiyeIsEmri.cumleBasi.yalin} ürünü (${expectedLabel}) ile uyuşmayan ${mismatchedRolls.length} top var. "Yine de gönder" seçeneğiyle onaylayın.`,
            {
              code: "ITEM_MISMATCH",
              expectedItemId: wo.targetItemId,
              expectedItemLabel: expectedLabel,
              mismatchedRolls: mismatchedRolls.map((r) => {
                const i = itemMap.get(r.itemId);
                return {
                  id: r.id,
                  barcode: r.barcode,
                  itemId: r.itemId,
                  itemLabel: i ? `${i.code} - ${i.name}` : r.itemId,
                };
              }),
            },
          );
        }
        // Override aktif — audit log için bilgi sakla (assign ilerde dispatch
        // metadata'ya eklenecek)
        uyari("dispatch", `Item mismatch override by user ${userId ?? "?"}: ` +
            `WO ${data.workOrderId} expects ${wo.targetItemId}, ` +
            `${mismatchedRolls.length} mismatched rolls accepted`,
        );
      }
    }

    // ROTA-ATLAMA UYARISI: hedef fason adımından ÖNCE rotada hâlâ PENDING bir
    // fason adımı varsa, mal o adımı atlıyor demektir (ör. ham stok zımparayı
    // atlayıp doğrudan boyahaneye). Sadece PENDING önceki-fason sayılır: ACTIVE =
    // meşru paralel parti (mal hâlâ orada), COMPLETED/SKIPPED = bitti. allowRouteSkip
    // ile bilinçli onay verilir (ITEM_MISMATCH ile aynı warn-then-confirm deseni).
    if (!data.allowRouteSkip) {
      const earlierPendingExternal = await prisma.workOrderStep.findFirst({
        where: {
          workOrderId: data.workOrderId,
          stepSequence: { lt: step.stepSequence },
          status: StepStatus.PENDING,
          station: { is: { type: StationType.EXTERNAL } },
        },
        orderBy: { stepSequence: "asc" },
        select: { id: true, stepSequence: true, station: { select: { name: true } } },
      });
      if (earlierPendingExternal) {
        throw AppError.badRequest(
          `Bu sevk rota sırasını atlıyor: önce "${earlierPendingExternal.station.name}" fason adımı bekliyor. "Yine de gönder" ile onaylayın.`,
          {
            code: "ROUTE_SKIP",
            skippedStep: {
              id: earlierPendingExternal.id,
              stationName: earlierPendingExternal.station.name,
              stepSequence: earlierPendingExternal.stepSequence,
            },
            targetStepSequence: step.stepSequence,
          },
        );
      }
    }

    // Sevk anında otomatik attach edilecek toplar (mobil sahada tek-adım akış için).
    // Top serbest stoktaysa (henüz iş emrine bağlanmamış), aynı transaction içinde
    // bu adıma attach edilir; operatör ayrıca attach çağrısı yapmak zorunda kalmaz.
    const autoAttachIds = new Set<string>();

    // ÇUVAL/SEVKİYAT GUARD'I (2026-07-30) — `workorder.service.attachRolls` (F5)
    // emsali. Aşağıdaki auto-attach dalı "serbest stok"a `currentStepId === null &&
    // status === STOCK` ile karar veriyor; ÇUVALA OKUTULMUŞ ham top da bu tanıma
    // uyuyor (NON_SACKABLE_STATUSES'ta STOCK YOK → ham top çuvala girebilir) ve
    // fasona gönderilebiliyordu: top AT_SUBCONTRACTOR olur ama `sackId` çuvalda
    // kalır → sevkte SHIPPED'e ezilip çift tüketilir. Attach'in normal yolu bunu
    // F5 ile zaten reddediyordu; açık kalan tek kapı bu auto-attach'ti.
    // Tüm ihlaller BİRLİKTE bildirilir (operatörü tek tek dolaştırmamak için).
    const committedRolls = rolls.filter((r) => r.sackId != null || r.shipmentId != null);
    if (committedRolls.length > 0) {
      const sackNoById = new Map(
        (
          await prisma.sack.findMany({
            where: {
              id: { in: committedRolls.map((r) => r.sackId).filter((x): x is string => !!x) },
            },
            select: { id: true, sackNo: true },
          })
        ).map((s) => [s.id, s.sackNo])
      );
      throw AppError.badRequest(
        committedRolls
          .map((r) =>
            r.sackId
              ? sackBlockMessage(
                  r.barcode ?? r.id,
                  sackNoById.get(r.sackId) ?? null,
                  "fasona gönderilemez"
                )
              : `Top ${r.barcode ?? r.id} bir sevkiyatta — fasona gönderilemez. Önce sevkiyattan çıkarın.`
          )
          .join(" ")
      );
    }

    for (const r of rolls) {
      // 1) Serbest stok → otomatik attach uygunluğu
      if (r.currentStepId === null && r.status === RollStatus.STOCK) {
        autoAttachIds.add(r.id);
        continue;
      }
      // 2) Zaten bu adıma bağlı → geç
      if (r.currentStepId !== data.stepId) {
        throw AppError.badRequest(
          `Top ${r.barcode} bu adımda değil (mevcut step: ${r.currentStepId ?? "yok"})`
        );
      }
      if (r.status !== RollStatus.IN_PRODUCTION && r.status !== RollStatus.STOCK) {
        throw AppError.badRequest(
          `Top ${r.barcode} sevke uygun değil (status: ${r.status})`
        );
      }
    }

    // K10/K11: bir sevk = bir parti. Seçilen topların mevcut parti (batchId) dağılımı.
    // 2+ parti + strateji yok → 409 MULTI_BATCH (Electron birleştir/ayır seçtirir).
    // MERGE → sevk anında en eski partide birleşir (aşağıda tx içinde).
    const existingBatchIds = [
      ...new Set(rolls.map((r) => r.batchId).filter((x): x is string => !!x)),
    ];

    // CROSS-WO PARTİ GUARD'I: sevk iptali batchId'yi bilinçli korur (parti üyeliği
    // attach'te doğar, iptal bozmaz) — bu yüzden STOCK+stepless bir top BAŞKA iş
    // emrinin partisini taşıyor olabilir. Böyle bir top serbest sanılıp sevke
    // alınırsa yabancı WO'nun partisi bu sevkin batchId'si olur (K10 ihlali) ve
    // splitRemainder yabancı partiyi bölerdi. Sessiz devralma YOK ("yıkıcı işlemde
    // açık onay" ilkesi): 400 + somut top/parti listesi. Çözüm: topu önce bu iş
    // emrine bağla (attach yeni parti damgalar) ya da eski iş emrinden çıkar.
    if (existingBatchIds.length > 0) {
      const batchScopes = await prisma.batch.findMany({
        where: { id: { in: existingBatchIds } },
        select: {
          id: true,
          batchNumber: true,
          workOrderId: true,
          mergedIntoId: true,
          mergedInto: { select: { batchNumber: true } },
          workOrder: { select: { workOrderNumber: true } },
        },
      });
      // K17: birleşmiş kaynak parti tarihçe satırıdır — yeni sevkin partisi olamaz
      // (toplar/sevkler merge'de survivor'a taşındı; buraya düşen top üyeliği
      // el ile bozulmuş demektir). İşlem survivor partide yapılmalı.
      const mergedBatch = batchScopes.find((b) => b.mergedIntoId);
      if (mergedBatch) {
        throw AppError.badRequest(
          `Parti ${mergedBatch.batchNumber}, ${mergedBatch.mergedInto?.batchNumber ?? mergedBatch.mergedIntoId} altına birleştirilmiş — işlem survivor partide yapılmalı`,
        );
      }
      const foreignById = new Map(
        batchScopes
          .filter((b) => b.workOrderId !== data.workOrderId)
          .map((b) => [b.id, b] as const),
      );
      if (foreignById.size > 0) {
        const offending = rolls.filter((r) => r.batchId && foreignById.has(r.batchId));
        throw AppError.badRequest(
          `${offending.length} top başka ${TERIM.terbiyeIsEmri.cekimKucuk.ilgi} partisine kayıtlı — bu sevke alınamaz. ` +
            `Önce topu bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} bağlayın (yeni parti oluşur) ya da kayıtlı olduğu ${TERIM.terbiyeIsEmri.cekimKucuk.ayrilma} çıkarın.`,
          {
            code: "FOREIGN_BATCH",
            foreignRolls: offending.map((r) => {
              const b = foreignById.get(r.batchId!)!;
              return {
                id: r.id,
                barcode: r.barcode,
                batchId: b.id,
                batchNumber: b.batchNumber,
                workOrderNumber: b.workOrder.workOrderNumber,
              };
            }),
          },
        );
      }
    }

    if (existingBatchIds.length > 1 && !data.multiBatchStrategy) {
      const picker = await prisma.batch.findMany({
        where: { id: { in: existingBatchIds } },
        select: { id: true, batchNumber: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      throw AppError.conflict(
        "Bu sevk birden fazla partiden top içeriyor (K11). Birleştir (en eski no yaşar) ya da parti başına ayrı sevk seçin.",
        {
          code: "MULTI_BATCH",
          batches: picker.map((b, i) => ({ id: b.id, batchNumber: b.batchNumber, oldest: i === 0 })),
        },
      );
    }

    const separate = existingBatchIds.length > 1 && data.multiBatchStrategy === "SEPARATE";
    if (separate && (warpBeamIds.length > 0 || yarnLines.length > 0)) {
      throw AppError.badRequest("Levent ya da iplik içeren sevk partilere bölünemez — birleştirin ya da ayrı sevk edin.", {
        code: "SEPARATE_WITH_BEAM_OR_YARN",
      });
    }

    // Decimal aritmetik — float drift olmasın; sevk kaydında string'e dökeriz.
    const totalQty = rolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0)
    );

    // withBarcodeRetry: dispatchNo (@unique) tx içinde nextPrefixedSequenceTx ile
    // üretiliyor; eşzamanlı iki sevk aynı FS+GGAAYY+NNNN'i hesaplarsa P2002
    // çakışmasında tx baştan denenir → sıra yeniden okunur (kartela/shipping deseni).
    // Bir sevkin tx gövdesi — tüm seçim için bir kez ya da (SEPARATE) parti başına AYNI tx'te sırayla.
    type DispatchGroup = {
      rolls: typeof rolls; autoAttachIds: Set<string>; existingBatchIds: string[];
      totalQty: Prisma.Decimal; warpBeamIds: string[]; yarnLines: typeof yarnLines;
    };
    const runTx = async (tx: Prisma.TransactionClient, g: DispatchGroup) => {
      const { rolls, autoAttachIds, existingBatchIds, totalQty, warpBeamIds, yarnLines } = g;
      // Fason completion yarışı (subcon #4): dispatch/receive/cancel/cancelReceipt/
      // directShip aynı WO satırını kilitlesin ki "tüm toplar döndü" sayımları
      // eşzamanlı dispatch'in commit'li AT_SUBCONTRACTOR toplarını görsün (yoksa
      // mal hâlâ fasondayken WO/refakat kartı yanlışlıkla COMPLETED'a kaçar).
      await touchWorkOrderTx(tx, data.workOrderId);
      // Stale-read guard (subcon #4): wo.status tx DIŞINDA (yukarıda 312) okundu;
      // eşzamanlı receive/cancel WO'yu bu sırada COMPLETED yapmış olabilir. Kilit
      // altında TAZE doğrula — yoksa mal hâlâ fasondayken COMPLETED WO'ya ek parti
      // sevk edilir (receive-first sıralaması).
      const woFresh = await tx.workOrder.findUnique({
        where: { id: data.workOrderId },
        select: { status: true },
      });
      if (
        !woFresh ||
        (woFresh.status !== WorkOrderStatus.PLANNED &&
          woFresh.status !== WorkOrderStatus.IN_PROGRESS)
      ) {
        throw AppError.conflict(
          `Bu ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} sevk yapılamaz: ${woFresh?.status ?? "bulunamadı"}. Sayfayı yenileyin.`
        );
      }

      // Step status TAZE (F73): step.status tx DIŞINDA okundu. WO kilidi (555)
      // altında eşzamanlı receive/cancel adımı COMPLETED, downstream directShip
      // SKIPPED yapmış olabilir. ACTIVE'e-açma kararı bayat status'a dayanırsa
      // yeni sevk topları AT_SUBCONTRACTOR olurken adım yanlış statüde kalır.
      const stepFresh = await tx.workOrderStep.findUnique({
        where: { id: step.id },
        select: { status: true, startedAt: true },
      });
      if (!stepFresh) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
      if (stepFresh.status === StepStatus.SKIPPED) {
        throw AppError.conflict(
          "Adım bu sırada atlandı (SKIPPED). Sevk yapılamaz. Sayfayı yenileyin."
        );
      }
      // Otomatik attach: serbest stoktaki toplar bu adıma bağlanır.
      // (status STOCK kalır — alt blok aynı transaction içinde AT_SUBCONTRACTOR'a çekecek.)
      // ATOMİK CLAIM: autoAttachIds tx-DIŞI bayat okumadan geliyor (currentStepId=null
      // & status=STOCK görülmüştü). Arada başka bir tx topu başka bir işe bağladıysa
      // (IN_PRODUCTION / currentStepId dolu) bu guardsız updateMany onu çalardı. WHERE'e
      // serbest-stok koşullarını koyup count'u doğrula → çalınma engellenir.
      // `sackId`/`shipmentId` null koşulu pre-check'in tx-içi ikizidir: araya giren
      // `scanIntoSack` ham topu çuvala alırsa WHERE eşleşmez → 409 (bkz. yukarıdaki
      // çuval guard'ı; F5/attachRolls claim'i ile aynı desen).
      if (autoAttachIds.size > 0) {
        const autoAttached = await tx.roll.updateMany({
          where: {
            id: { in: Array.from(autoAttachIds) },
            status: RollStatus.STOCK,
            currentStepId: null,
            sackId: null,
            shipmentId: null,
          },
          data: { currentStepId: data.stepId },
        });
        if (autoAttached.count !== autoAttachIds.size) {
          throw AppError.conflict(
            "Serbest stok toplardan biri bu sırada başka bir işe bağlandı ya da bir çuvala okutuldu. Listeyi yenileyip tekrar deneyin."
          );
        }
      }

      // Step ACTIVE'e çek. PENDING → ilk sevk; COMPLETED → adıma ek parti
      // sevki yapılıyor, adımı YENİDEN AÇ (çoklu sevk). startedAt korunur,
      // completedAt sıfırlanır ki "şu an açık" görünsün.
      if (
        stepFresh.status === StepStatus.PENDING ||
        stepFresh.status === StepStatus.COMPLETED
      ) {
        await tx.workOrderStep.update({
          where: { id: step.id },
          data: {
            status: StepStatus.ACTIVE,
            startedAt: stepFresh.startedAt ?? new Date(),
            completedAt: null,
          },
        });
      }
      // WO henüz PLANNED ise IN_PROGRESS'e çek (fason sevki = üretim başlangıcı)
      await ensureWorkOrderInProgress(tx, data.workOrderId);

      // Sevkin partisini belirle (K10). Tek mevcut parti varsa serbest/partisiz toplar
      // da o partiye katılır; hiç parti yoksa (hepsi serbest stok) sevk anında YENİ
      // parti doğar (K3 dalgası) — createBatchTx yalnız P üretir; kart iş emri başına
      // (WO açılışında doğdu), parti kart üretmez.
      const dispatchRollIdsAll = rolls.map((r) => r.id);
      let dispatchBatchId: string;
      const remainderBatches: CreateBatchResult["batch"][] = [];

      // K5 kalan-böl ortak yardımcısı: verilen partinin bu sevke GİRMEYEN canlı
      // toplarını (farklı kazana gidecekler) YENİ partiye ayırır.
      const splitRemainder = async (srcBatchId: string): Promise<void> => {
        const rem = await tx.roll.findMany({
          where: {
            batchId: srcBatchId,
            id: { notIn: dispatchRollIdsAll },
            status: { in: [RollStatus.IN_PRODUCTION, RollStatus.STOCK] },
          },
          select: { id: true },
        });
        if (rem.length > 0) {
          const r = await createBatchTx(tx, {
            workOrderId: data.workOrderId,
            rollIds: rem.map((x) => x.id),
            splitFromId: srcBatchId,
            userId,
          });
          remainderBatches.push(r.batch);
          // K18: kalanlar YENİ parti numarası aldı — canlı topların fiziksel
          // etiketindeki Parti No bayat → yeniden bas uyarısı (rem sorgusu
          // zaten canlı statülerle filtreli; notIn savunma katmanı).
          await tx.roll.updateMany({
            where: { id: { in: rem.map((x) => x.id) }, status: { notIn: K18_DEAD_STATUSES } },
            data: { labelDirty: true },
          });
        }
      };

      if (existingBatchIds.length > 1) {
        // K11 MERGE (strateji üstte doğrulandı): EN ESKİ parti survivor; seçilen TÜM
        // toplar ona taşınır; her kaynağın kalanı K5 ile yeni partiye; survivor-dışı
        // kaynak kartları VOID + boşalan izsiz kaynaklar silinir.
        // WO-scope tazelemesi (woFresh deseni): cross-WO guard tx DIŞINDA koştu;
        // pencerede parti başka işlemle değişmiş/silinmiş olabilir. Scope'lu taze
        // okuma + count kontrolü — yabancı parti survivor OLAMAZ.
        // mergedIntoId:null (K17 reddi tx-İÇİNDE de): ön-guard (~:694) tx DIŞINDA —
        // pencerede parti bir K15 merge'ine kaynak olmuş olabilir; birleşmiş
        // tarihçe satırı yeni sevkin partisi/survivor'ı OLAMAZ.
        const batchRows = await tx.batch.findMany({
          where: { id: { in: existingBatchIds }, workOrderId: data.workOrderId, mergedIntoId: null },
          select: { id: true, batchNumber: true },
          orderBy: { createdAt: "asc" },
        });
        if (batchRows.length !== existingBatchIds.length) {
          throw AppError.conflict(
            "Partilerden biri bu sırada başka bir işlemle değişti (birleştirilmiş olabilir). Listeyi yenileyip tekrar deneyin."
          );
        }
        dispatchBatchId = batchRows[0].id;
        // K18: sevk-anı birleştirmede survivor DIŞI partiden gelen CANLI topların
        // fiziksel etiketindeki Parti No bayatlar → yeniden bas uyarısı. İlk atama
        // (batchId null — attach dalgası) K18 kapsamı DIŞI: etiket henüz parti
        // numarasıyla basılmamıştır, bayraklanmaz. Zaten survivor'da olan top
        // üyelik değiştirmez — bayraklanmaz.
        const k18ChangingIds = rolls
          .filter((r) => r.batchId && r.batchId !== dispatchBatchId)
          .map((r) => r.id);
        if (k18ChangingIds.length > 0) {
          await tx.roll.updateMany({
            where: { id: { in: k18ChangingIds }, status: { notIn: K18_DEAD_STATUSES } },
            data: { labelDirty: true },
          });
        }
        await tx.roll.updateMany({
          where: { id: { in: dispatchRollIdsAll } },
          data: { batchId: dispatchBatchId },
        });
        for (const b of batchRows) await splitRemainder(b.id);
        // Kart WO başına — sevk-birleştirmede karta dokunulmaz; boş izsiz kaynaklar silinir.
        for (const b of batchRows.slice(1)) {
          await deleteIfEmptyAndTracelessTx(tx, b.id);
        }
      } else if (existingBatchIds.length === 1) {
        dispatchBatchId = existingBatchIds[0];
        // WO-scope tazelemesi (woFresh deseni): cross-WO guard tx DIŞINDA koştu;
        // tx içinde taze doğrula — yabancı parti bu sevkin batchId'si OLAMAZ.
        await assertBatchInWorkOrderTx(tx, dispatchBatchId, data.workOrderId);
        // K17 reddi tx-İÇİNDE de (MAJOR-2): ön-guard (~:694) tx DIŞINDA koştu —
        // pencerede parti bir K15 merge'ine kaynak olmuş olabilir; birleşmiş
        // tarihçe satırı yeni sevk ALAMAZ (toplar/sevkler survivor'a taşındı).
        const freshBatch = await tx.batch.findUnique({
          where: { id: dispatchBatchId },
          select: { batchNumber: true, mergedIntoId: true, mergedInto: { select: { batchNumber: true } } },
        });
        if (freshBatch?.mergedIntoId) {
          throw AppError.conflict(
            `Parti ${freshBatch.batchNumber}, ${freshBatch.mergedInto?.batchNumber ?? freshBatch.mergedIntoId} altına birleştirilmiş — listeyi yenileyin.`,
          );
        }
        // Serbest/partisiz sevk topları bu partiye katılır. K18 bayrağı YOK:
        // ilk atama (attach dalgası) kapsam dışı — etiket henüz parti
        // numarasıyla basılmamıştır, bayatlayacak bir şey yok.
        await tx.roll.updateMany({
          where: { id: { in: dispatchRollIdsAll }, batchId: null },
          data: { batchId: dispatchBatchId },
        });
        // K5 OTO-BÖL: sevke girmeyen kalan → yeni parti (giden orijinal P'yi korur).
        await splitRemainder(dispatchBatchId);
      } else {
        // Hepsi serbest stok → sevk anında YENİ parti doğar (K3 dalgası). Kart WO
        // başına (WO açılışında doğdu) — parti yeni kart üretmez. K18 bayrağı YOK:
        // ilk atama (attach dalgası) kapsam dışı — etiket henüz basılmamış olur.
        const created = await createBatchTx(tx, {
          workOrderId: data.workOrderId,
          rollIds: dispatchRollIdsAll,
          userId,
        });
        dispatchBatchId = created.batch.id;
      }

      // Dispatch numarası
      const now = new Date();
      const dispatchNo = await nextSubcontractorDocNoTx(tx, "subcontractorDispatch", now);

      const dispatch = await sequentialTx(tx).subcontractorDispatch.create({
        data: {
          dispatchNo,
          workOrderId: data.workOrderId,
          // K10: bir sevk = bir parti. Sevkin partisi yukarıda belirlendi/dolduruldu.
          batchId: dispatchBatchId,
          stepId: data.stepId,
          subcontractorId: data.subcontractorId,
          // Plan snapshot — sevk anında step.plannedSubcontractorId ne ise dondurulur.
          // step.plannedSubcontractorId ileride değişse bile rapor için bu sabit kalır.
          plannedSubcontractorId: step.plannedSubcontractorId ?? null,
          plateNumber: data.plateNumber ?? null,
          driverName: data.driverName ?? null,
          dispatchedById: userId ?? null,
          notes: data.notes ?? null,
          // Belgeye DONDURULMAZ — canlı kolon; sevk sonrası düzenlenebilir,
          // baskı her zaman güncel değeri overlay olarak gösterir (talimat alanı).
          // Operatör notu (flag açıkken) öncelikli; boşsa sevk edilen adımın notu
          // (WorkOrderStep.notes) default kopyalanır → o adımın çeki listesine basılır.
          instruction: (data.instruction?.trim() || step.notes) ?? null,
          totalQty,
          items: {
            create: rolls.map((r) => ({
              rollId: r.id,
              dispatchedQty: r.currentQty,
              dispatchedWeight: r.weightKg,
            })),
          },
        },
        include: {
          items: true,
          subcontractor: true,
          step: { include: { station: true } },
        },
      });

      // F1 LEVENT KALEMLERİ — sevk satırından SONRA (kalem `dispatchId` ister), belge donmadan ÖNCE
      // (irsaliye levent satırını basar). Metre olaylardan kilit altında okunur; `totalQty` snapshot'ı
      // Σ kalem kuralını korur (consistency §19) — top metresi + levent metresi.
      const beamLines = warpBeamIds.length > 0
        ? await dispatchWarpBeamItemsTx(tx, { dispatchId: dispatch.id, warpBeamIds, userId })
        : null;
      if (beamLines) {
        await tx.subcontractorDispatch.update({ where: { id: dispatch.id }, data: { totalQty: totalQty.plus(beamLines.totalM) } });
      }
      // G1 İPLİK KALEMLERİ — kg `totalQty`ye GİRMEZ (metre toplamı; §19 `kind<>'YARN'`), `yarnTotalKg` ayrı okunur.
      const yarnItems = yarnLines.length > 0
        ? await dispatchYarnItemsTx(tx, { dispatchId: dispatch.id, lines: yarnLines, userId })
        : null;

      // RESMİ BELGE — fason sevk irsaliyesi v1 BURADA donar (PrintedDocument).
      // Builder az önce yaratılan dispatch+item'ları aynı tx içinden okur;
      // kaynak sonradan değişse bile belge sabit kalır. Düzeltme = reissue.
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DISPATCH,
        dispatch.id,
        userId
      );

      // Refakat kartının parti bloğundaki "Sevk" sütunu (fason firma + sevk no)
      // ancak SEVKTEN SONRA dolar — eldeki kâğıt o sütunda boş kaldı → bayat.
      // (Sevk anında doğan/bölünen partiler zaten createBatchTx'ten işaretlendi;
      // bu çağrı sevkin KENDİSİNİ, yani mevcut partiye eklenen bilgiyi kapsar.)
      await markTravelerCardDirtyTx(tx, data.workOrderId);

      // Rolls: AT_SUBCONTRACTOR + SUBCONTRACTOR_SENT log (TOPLU — eski kod top
      // başına update+findFirst+create+upsert yapıyordu = N+1).
      const dispatchRollIds = rolls.map((r) => r.id);

      // 1) status → AT_SUBCONTRACTOR + dal kimliği (Phase 4): bu sevk = bir dal,
      //    anahtarı dispatch.id. Born roll (kabul) ve Tambur çocuğu bunu kalıtır.
      //
      // ATOMİK CLAIM: status kontrolü (satır ~400 + 468-485) tx DIŞINDA yapıldığı
      // için iki operatör aynı topu eşzamanlı sevke okutursa ikisi de guard'ı geçip
      // burada koşulsuz flip yapabilirdi → top iki dispatch'e girer, batchId
      // ezilirdi. WHERE'e kabul-statülerini koyup etkilenen satır sayısını doğrula
      // (kartela.dispatch ile aynı desen). autoAttach topları bu tx'te STOCK kalır,
      // diğerleri STOCK|IN_PRODUCTION → ikisi de bu küme içinde.
      // WHERE'e currentStepId=data.stepId de eklenir: step-eşleşme kontrolü artık
      // tx-İÇİ/atomik. (Eskiden yalnız ön-döngü ~488-493 tx DIŞINDA bakıyordu →
      // okuma ile claim arasında top başka adıma taşınırsa claim status'le geçip
      // topu yanlış adımdan çalabilirdi.) Claim anında her dispatchRollId zaten
      // data.stepId'de: autoAttach toplar yukarıda (claim'den ÖNCE) bu değere
      // çekildi; zaten-bağlı toplar ön-döngüde doğrulandı. Meşru top dışlanmaz.
      // `sackId`/`shipmentId` null: çuvala okutulmuş / sevkiyata atanmış top fasona
      // ÇIKAMAZ (2026-07-30 hayalet-içerik guard'ı; pre-check'in tx-içi ikizi).
      // Meşru top dışlanmaz — iş emrine bağlı top invariant gereği çuvalsızdır
      // (attachRolls F5 sackId/shipmentId null şartı koyar).
      // ⚠️ ÇIKIŞ UCUNUN KANITI CLAIM'DEN ÖNCE OKUNUR: flip `status`u ezdiği için
      // sevk sonrası "hangi durumdan çıktı" sorusu cevapsız kalır — sevkteki
      // `preShipStatus` gibi bir kolon BURADA YOK. Claim başarılıysa (sayı
      // eşleşmesi aşağıda zorunlu) bu küme ile claim kümesi AYNIDIR.
      const cikisKaniti = await tx.roll.findMany({
        where: { id: { in: dispatchRollIds } },
        select: { id: true, status: true, warehouseId: true, currentQty: true, barcode: true },
      });
      const stoktanCikanlar = cikisKaniti.filter((r) => WAREHOUSE_STOCK_STATUSES.includes(r.status));
      // K6 — stok kümesinden ÇIKAN yol: deposuz top 409 + barkod listesi.
      // (Ölçüldü 2026-09-13: fabrika kopyasında deposuz stok topu 0 ⇒ maruziyet yok.)
      assertRollsHaveWarehouse(stoktanCikanlar, "Fasona gönderilemez");
      const claimed = await tx.roll.updateMany({
        where: {
          id: { in: dispatchRollIds },
          status: { in: [RollStatus.IN_PRODUCTION, RollStatus.STOCK] },
          currentStepId: data.stepId,
          sackId: null,
          shipmentId: null,
        },
        data: { status: RollStatus.AT_SUBCONTRACTOR },
      });
      if (claimed.count !== dispatchRollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir sevke alınmış, farklı bir adıma taşınmış ya da bir çuvala okutulmuş. Listeyi yenileyip tekrar deneyin."
        );
      }

      // DEPO DEFTERİ — mal stok kümesinden ÇIKTI (fason firmasına). ⚠️ YALNIZ
      // `STOCK`tan çıkan top satır yazar: claim yüklemi `IN_PRODUCTION | STOCK`
      // kabul ediyor ve `IN_PRODUCTION` stok kümesinde DEĞİLDİR — oradan çıkan top
      // için "stok dışından stok dışına" satır yazılmaz (tasarım §64). Bu bir
      // SESSİZ ATLAMA değil, OLAY YOKLUĞUDUR.
      //
      // ⚠️ Bu yol 2026-09-13'e kadar deftere HİÇ satır yazmıyordu (tüm serviste
      // tek defter çağrısı vardı: kabul) ⇒ `STOCK`tan fasona çıkan top defterde iz
      // bırakmıyordu. `Roll.warehouseId` bilerek temizlenmez (dönüş adresi), o
      // yüzden çıkışı yalnız bu satır kaydeder — sevkteki kalıbın aynısı.
      if (stoktanCikanlar.length > 0) {
        await postStockMoves(
          tx,
          stoktanCikanlar.map((r) => ({
            rollId: r.id,
            eventType: WarehouseEventType.EXTERNAL, // şema: "üçüncü şahıs — fason/kartela çıkışı
            qty: r.currentQty,
            from: { warehouseId: r.warehouseId, status: r.status },
            to: { warehouseId: null, status: RollStatus.AT_SUBCONTRACTOR },
            reasonCode: STOCK_MOVE_REASON.FASON_DISPATCH,
            userId: userId ?? null,
          })),
        );
      }

      // 2) Açık movement'ı olan topları tek sorguda bul; OLMAYANLAR için yeni
      //    movement aç (açık movement kapanmasın — operatör START atmamış olabilir).
      const openMovements = await tx.rollMovement.findMany({
        where: { ...ACTIVE_MOVEMENT, rollId: { in: dispatchRollIds }, workOrderStepId: data.stepId, exitedAt: null },
        select: { rollId: true },
      });
      const hasOpenMovement = new Set(openMovements.map((m) => m.rollId));
      const newMovements = rolls
        .filter((r) => !hasOpenMovement.has(r.id))
        .map((r) => ({
          rollId: r.id,
          workOrderStepId: data.stepId,
          qtyIn: r.currentQty,
          weightIn: r.weightKg,
          operatorId: userId ?? null,
          notes: `DISPATCH:${dispatchNo}`,
        }));
      if (newMovements.length > 0) {
        await tx.rollMovement.createMany({ data: newMovements });
      }

      // 3) Per-roll operation log — doğal idempotency: @@unique(rollId,stepId,opType)
      //    + skipDuplicates = eski upsert(update:{}) ile birebir aynı (re-dispatch'te
      //    ilk sevk kaydı korunur).
      await tx.rollOperation.createMany({
        data: rolls.map((r) => ({
          rollId: r.id,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_SENT,
          operatorId: userId ?? null,
          metadata: { dispatchNo, qty: r.currentQty, weight: r.weightKg } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });

      // Refakat kartı DEPARTURE — iş emrinin kartına (WO başına tek kart).
      const departureCard = await tx.travelerCard.findFirst({
        where: { workOrderId: data.workOrderId, status: TravelerCardStatus.ACTIVE },
        select: { id: true },
      });
      if (departureCard) {
        await tx.travelerCardScan.create({
          data: {
            cardId: departureCard.id,
            stationId: step.stationId,
            workOrderStepId: step.id,
            scanType: ScanType.DEPARTURE,
            scannedById: userId ?? null,
            notes: `Fasona sevk: ${dispatchNo}`,
          },
        });
      }

      return { dispatch, remainderBatches, beamLines, yarnItems };
    };
    const whole: DispatchGroup = { rolls, autoAttachIds, existingBatchIds, totalQty, warpBeamIds, yarnLines };

    const auditDispatch = async (result: Awaited<ReturnType<typeof runTx>>, g: DispatchGroup) => {
    const { rolls, autoAttachIds, totalQty } = g;
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: result.dispatch.id,
      newData: {
        dispatchNo: result.dispatch.dispatchNo,
        workOrderId: data.workOrderId,
        stepId: data.stepId,
        subcontractorId: data.subcontractorId,
        plannedSubcontractorId: step.plannedSubcontractorId ?? null,
        rollCount: rolls.length,
        autoAttachedRollCount: autoAttachIds.size,
        routeSkipOverride: !!data.allowRouteSkip,
        itemMismatchOverride: !!data.allowItemOverride,
        totalQty: result.beamLines ? totalQty.plus(result.beamLines.totalM) : totalQty,
        ...(result.beamLines ? { warpBeamCount: result.beamLines.lines.length, warpBeamNos: result.beamLines.lines.map((l) => l.beamNo) } : {}),
        ...(result.yarnItems ? { yarnItemCount: result.yarnItems.lines.length, yarnTotalKg: result.yarnItems.totalKg.toString() } : {}),
      },
    });

    // Kalan parti(ler) doğduysa (K5 kısmi sevk / K11 birleştir): parti audit'i tx DIŞINDA.
    // Kart audit'i YOK — kart iş emri başına (WO açılışında), parti kart üretmez.
    for (const rb of result.remainderBatches) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "BATCH",
        recordId: rb.id,
        newData: {
          batchNumber: rb.batchNumber,
          workOrderId: data.workOrderId,
          splitFromId: rb.splitFromId,
          event: "REMAINDER_SPLIT_ON_DISPATCH",
        },
      });
    }
    };

    // K11 SEPARATE: parti başına ayrı sevk (kendi FS no'su), serbest toplar ayrı grup; hepsi TEK tx.
    if (separate) {
      const order = (await prisma.batch.findMany({
        where: { id: { in: existingBatchIds } }, select: { id: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })).map((b) => b.id);
      const groups: DispatchGroup[] = [...order, null]
        .map((key) => rolls.filter((r) => (r.batchId ?? null) === key))
        .filter((rs) => rs.length > 0)
        .map((rs) => ({
          rolls: rs,
          autoAttachIds: new Set(rs.filter((r) => autoAttachIds.has(r.id)).map((r) => r.id)),
          existingBatchIds: rs[0].batchId ? [rs[0].batchId] : [],
          totalQty: rs.reduce((acc, r) => acc.plus(r.currentQty), new Prisma.Decimal(0)),
          warpBeamIds: [],
          yarnLines: [],
        }));
      const done = await withBarcodeRetry(() =>
        prisma.$transaction(async (tx) => {
          const out: { g: DispatchGroup; r: Awaited<ReturnType<typeof runTx>> }[] = [];
          for (const g of groups) out.push({ g, r: await runTx(tx, g) });
          return out;
        }),
      );
      for (const { g, r } of done) await auditDispatch(r, g);
      return {
        success: true,
        data: { separate: true, dispatchCount: done.length, dispatches: done.map((x) => x.r.dispatch) },
        message: `${done.length} parti ayrı ayrı sevk edildi: ${done.map((x) => x.r.dispatch.dispatchNo).join(", ")}`,
      };
    }

    const result = await withBarcodeRetry(() => prisma.$transaction((tx) => runTx(tx, whole)));
    await auditDispatch(result, whole);

    const remainderNumbers = result.remainderBatches.map((b) => b.batchNumber);
    return {
      success: true,
      data:
        remainderNumbers.length > 0
          ? {
              ...result.dispatch,
              remainderBatches: result.remainderBatches,
              // Köprü: K5 tekil kalan tüketicileri (test) için ilk kalanı da ver.
              remainderBatch: result.remainderBatches[0],
            }
          : result.dispatch,
      message:
        `Fason sevki oluşturuldu: ${result.dispatch.dispatchNo} (${rolls.length} top, ${totalQty.toFixed(1)}m)` +
        (remainderNumbers.length > 0
          ? ` — kalan toplar yeni parti(ler)e ayrıldı: ${remainderNumbers.join(", ")}`
          : ""),
    };
  }

export async function bulkDispatchStep(this: SubcontractorServiceThis, 
    data: {
      workOrderId: string;
      stepId: string;
      /** Yoksa adımın plannedSubcontractorId'si kullanılır. */
      subcontractorId?: string;
      /** Verilirse yalnız bu toplar sevk edilir (alt-küme seçimi); yoksa adımdaki
       *  bekleyen TÜM toplar. */
      rollIds?: string[];
      /** dispatch()'e iletilir — rota-atlama uyarısını bilinçli geçmek için. */
      allowRouteSkip?: boolean;
      instruction?: string;
      plateNumber?: string;
      driverName?: string;
      /** K11 çok-parti çözümü. MERGE → dispatch()'e iletilir (en eskide birleşir);
       *  SEPARATE → burada parti başına AYRI sevk döngüsü. */
      multiBatchStrategy?: "MERGE" | "SEPARATE";
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: { station: { select: { type: true, name: true } } },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        "Toplu sevk yalnızca fason (EXTERNAL) adımlar için yapılabilir."
      );
    }
    if (step.status === StepStatus.SKIPPED) {
      throw AppError.conflict("Adım atlanmış (SKIPPED). Sevk yapılamaz.");
    }
    const subcontractorId = data.subcontractorId ?? step.plannedSubcontractorId;
    if (!subcontractorId) {
      throw AppError.badRequest(
        "Fason firma planlanmamış — önce bu adıma firma atayın veya sevk ederken firma seçin."
      );
    }

    // Bu adımda fiziksel BEKLEYEN toplar (fasonda OLMAYAN). Konum-tabanlı toplama;
    // dispatch()'in atomik claim'i (status IN_PRODUCTION|STOCK + currentStepId=stepId)
    // yarış güvenliğini zaten sağlar (PR #42). AT_SUBCONTRACTOR toplar dışlanır.
    // rollIds verildiyse yalnız o alt-küme (UI'da operatör seçti).
    const hasSubset = !!data.rollIds && data.rollIds.length > 0;
    const rolls = await prisma.roll.findMany({
      where: {
        currentStepId: data.stepId,
        status: { in: [RollStatus.IN_PRODUCTION, RollStatus.STOCK] },
        ...(hasSubset ? { id: { in: data.rollIds } } : {}),
      },
      select: { id: true },
    });
    if (rolls.length === 0) {
      throw AppError.badRequest("Bu adımda sevk edilecek bekleyen top yok.");
    }
    if (hasSubset && rolls.length !== data.rollIds!.length) {
      throw AppError.badRequest(
        "Seçilen toplardan bazıları artık sevke uygun değil — listeyi yenileyin."
      );
    }

    // K11 SEPARATE dahil strateji `dispatch`e aynen gider: parti başına ayrı sevk orada TEK tx'te.
    return this.dispatch(
      {
        workOrderId: data.workOrderId,
        stepId: data.stepId,
        subcontractorId,
        rollIds: rolls.map((r) => r.id),
        allowRouteSkip: data.allowRouteSkip,
        instruction: data.instruction,
        plateNumber: data.plateNumber,
        driverName: data.driverName,
        multiBatchStrategy: data.multiBatchStrategy,
      },
      userId
    );
  }

export async function transferToNextFason(this: SubcontractorServiceThis, 
    data: {
      workOrderId: string;
      stepId: string; // mevcut (kaynak) fason adım
      /** Yoksa sonraki adımın plannedSubcontractorId'si kullanılır. */
      nextSubcontractorId?: string;
      /** Verilirse yalnız bu (AT_SUBCONTRACTOR) toplar aktarılır; yoksa hepsi. */
      rollIds?: string[];
      instruction?: string;
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: { type: true, name: true } },
        workOrder: {
          include: {
            steps: {
              orderBy: { stepSequence: "asc" },
              include: { station: { select: { type: true, name: true } } },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest("Bu adım fason (EXTERNAL) değil.");
    }

    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    // F76: ilk NON-SKIPPED sonraki adım — SKIPPED terminal adıma bağlanınca top
    // akışta görünmez, WO tamamlanamaz (recomputeStepStatus SKIPPED'e dokunmaz).
    const nextStep =
      currentIndex >= 0
        ? allSteps.slice(currentIndex + 1).find((s) => s.status !== StepStatus.SKIPPED) ?? null
        : null;
    if (!nextStep) {
      throw AppError.badRequest(
        "Bu fason son adım — sonraki fason yok. Mal kabulü için Fason Kabul ekranını kullanın."
      );
    }
    if (nextStep.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        "Sonraki adım fason değil — normal Fason Kabul ekranını kullanın."
      );
    }

    // Bu adımda fasonda (AT_SUBCONTRACTOR) olan toplar + hangi sevke (firma) ait.
    // AT_SUBCONTRACTOR topun batchId'si (→ Batch); kaynak dispatch
    // `SubcontractorDispatch.batchId` üzerinden bulunur. Makbuzun stamp'leyeceği
    // firma fiziksel malı tutan firma olmalı (rapor doğruluğu).
    const hasSubset = !!data.rollIds && data.rollIds.length > 0;
    const atSubRolls = await prisma.roll.findMany({
      where: {
        currentStepId: data.stepId,
        status: RollStatus.AT_SUBCONTRACTOR,
        ...(hasSubset ? { id: { in: data.rollIds } } : {}),
      },
      select: { id: true, currentQty: true, batchId: true },
    });
    if (atSubRolls.length === 0) {
      throw AppError.badRequest("Bu fasonda aktarılacak (fasonda bekleyen) top yok.");
    }
    if (hasSubset && atSubRolls.length !== data.rollIds!.length) {
      throw AppError.badRequest(
        "Seçilen toplardan bazıları artık aktarıma uygun değil — listeyi yenileyin."
      );
    }

    const batchIds = [
      ...new Set(
        atSubRolls
          .map((r) => r.batchId)
          .filter((x): x is string => !!x)
      ),
    ];
    // Parti (batchId) → firma: partinin BU ADIMDAKİ açık sevkinin firması (K10).
    // stepId scope ŞART: bir parti birden fazla fason adımından geçmişse
    // (ör. Zımpara→Boyahane), önceki adımın kabul edilmiş dispatch'i hâlâ
    // cancelledAt=null olur; stepId olmadan batchId→firma 1'e-çok olur ve
    // Map sona geleni (bayat firma) tutup yanlış "farklı firma" üretir.
    // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
    // merge sonrası survivor'da aynı adımda DÖNMÜŞ + AÇIK sevk yan yana durabilir;
    // outstanding koşulu olmadan Map last-wins belirsizliği dönmüş sevkin firmasını
    // tutup aktarımı yanlış firmaya (ya da yanlış redde) götürürdü.
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { batchId: { in: batchIds }, stepId: data.stepId, ...OPEN_OUTSTANDING },
      select: { batchId: true, subcontractorId: true },
    });
    const firmByBatch = new Map(dispatches.map((d) => [d.batchId, d.subcontractorId]));

    // Paralel partilerde toplar farklı firmalardan gelebilir → firma başına ayrı
    // kabul (receive tek subcontractorId stamp'liyor; per-roll eşleşme
    // sourceDispatchItemId ile zaten doğru, ama makbuz başlığı doğru firmayı taşımalı).
    const byFirm = new Map<string, typeof atSubRolls>();
    for (const r of atSubRolls) {
      const firmId = r.batchId ? firmByBatch.get(r.batchId) : undefined;
      if (!firmId) {
        throw AppError.conflict(
          "Fasonda bekleyen topun kaynak sevki bulunamadı. Listeyi yenileyip tekrar deneyin."
        );
      }
      const list = byFirm.get(firmId) ?? [];
      list.push(r);
      byFirm.set(firmId, list);
    }

    // 1) Her firma grubu için kabul — born açık-kumaş toplar SONRAKİ adıma doğar
    //    (metraj 1:1: zımparada çekme yok; kesin ölçüm boyahane dönüşünde).
    //    Her receive'in makbuz id'sini topla → DOĞAN topları KESİN belirlemek için.
    const receiptIds: string[] = [];
    for (const [firmId, firmRolls] of byFirm) {
      const recv = await this.receive(
        {
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          subcontractorId: firmId,
          returns: firmRolls.map((r) => ({ rollId: r.id })),
          newRolls: firmRolls.map((r) => ({ qty: Number(r.currentQty) })),
        },
        userId
      );
      const rId = (recv.data as { id?: string } | undefined)?.id;
      if (rId) receiptIds.push(rId);
    }

    // 2) Bu kabullerden DOĞAN topları kesin bul: born toplar Roll.parentReceiptId ile
    //    makbuza bağlı (ReceiptItem.newRollId DEĞİL — o tüketilen orijinaldir).
    //    "tüm bekleyeni süpür" yerine TAM bu born topları sevk et → kısmi aktarımda
    //    ve boyahanede duran ilgisiz IN_PRODUCTION topları korur.
    const bornRolls = await prisma.roll.findMany({
      where: {
        parentReceiptId: { in: receiptIds },
        currentStepId: nextStep.id,
        status: RollStatus.IN_PRODUCTION,
      },
      select: { id: true },
    });

    // Firma planlanmamışsa burada 400 atar; toplar boyahane adımında bekler
    // (kurtarılabilir kısmi başarı) — planlamacı firma atayıp "Sevk Et" der.
    const dispatchResult = await this.bulkDispatchStep(
      {
        workOrderId: data.workOrderId,
        stepId: nextStep.id,
        subcontractorId: data.nextSubcontractorId,
        rollIds: bornRolls.map((r) => r.id),
        // Aktarım born topları meşru olarak sonraki fasona gönderir → rota-atlama
        // uyarısı yanlış tetiklenmesin (önceki adım zaten COMPLETED ama explicit ver).
        allowRouteSkip: true,
        instruction: data.instruction,
      },
      userId
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: data.workOrderId,
      newData: {
        fasonTransfer: {
          fromStepId: data.stepId,
          fromStation: step.station.name,
          toStepId: nextStep.id,
          toStation: nextStep.station.name,
          rollCount: atSubRolls.length,
        },
      },
    });

    return {
      success: true,
      data: dispatchResult.data,
      message:
        `${atSubRolls.length} top ${step.station.name} → ${nextStep.station.name} aktarıldı. ` +
        (dispatchResult.message ?? ""),
    };
  }

export async function previewDownstreamFasonCeki(
    workOrderId: string,
    stepId: string
  ): Promise<ApiResponse<{ html: string }>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: { select: { name: true, code: true, type: true } },
        // "BOYANACAK RENK" satırı bu adımın renk VERİP vermediğine bakar
        // (`resolveStepDyeColor`) — taslak ile gerçek sevk aynı yüklemi kullanır.
        requiredCategory: { select: { appliesColor: true } },
        plannedSubcontractor: { select: { id: true, name: true, code: true } },
        workOrder: {
          select: {
            id: true,
            workOrderNumber: true,
            type: true,
            parameters: true,
            // Çekideki tek EN değerinin kaynağı (bkz. assembleFasonCekiDoc notu).
            width: true,
            targetColor: { select: { name: true } },
            // `propertyId` → adım süzgeci (bkz. resolveStepWorkInstructions).
            targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true, property: { select: { name: true } } } },
            steps: {
              orderBy: { stepSequence: "asc" },
              select: { id: true, stationId: true },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    if (step.workOrderId !== workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest("Çeki taslağı yalnızca fason (EXTERNAL) adımlar için.");
    }
    if (!step.plannedSubcontractor) {
      throw AppError.badRequest("Bu fason adımına firma planlanmamış — önce firma atayın.");
    }

    // Önceki adım = sıradaki bir önceki adım; orada fasonda (AT_SUBCONTRACTOR)
    // bekleyen toplar bu adımın projeksiyon mallarıdır (zımpara→boyahane 1:1).
    const orderedSteps = step.workOrder.steps;
    const idx = orderedSteps.findIndex((s) => s.id === stepId);
    const prevStep = idx > 0 ? orderedSteps[idx - 1] : null;
    if (!prevStep) {
      throw AppError.badRequest("Bu adımın öncesinde fason adımı yok — taslak çeki üretilemez.");
    }
    const projected = await prisma.roll.findMany({
      where: { currentStepId: prevStep.id, status: RollStatus.AT_SUBCONTRACTOR },
      include: {
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
        // Taslakta henüz sevk (dolayısıyla batchId) YOK — parti topların üyeliğinden
        // projekte edilir. Gerçek sevkte K10 tek partiye indirir; taslak o güvenceyi
        // taşıyamadığı için çoğulu da basabilmeli (aşağıda virgüllü liste).
        batch: { select: { batchNumber: true } },
      },
      orderBy: ROLL_DISPLAY_ORDER,
    });
    if (projected.length === 0) {
      throw AppError.badRequest(
        "Önceki fason adımında bekleyen mal yok — önce oraya sevk yapın."
      );
    }

    const rolls = projected.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      itemCode: r.item?.code ?? "",
      itemName: r.item?.name ?? "",
      colorCode: r.color?.code ?? null,
      colorName: r.color?.name ?? null,
      dispatchedQty: Number(r.currentQty),
      dispatchedWeight: r.weightKg != null ? Number(r.weightKg) : null,
      qualityGrade: r.qualityGrade ?? "",
      width: r.width != null ? Number(r.width) : null,
    }));
    const totalQty = Number(rolls.reduce((s, r) => s.plus(r.dispatchedQty), new Prisma.Decimal(0)));
    // Partisiz top (batchId null) meşrudur → listeye girmez, ama diğerlerini de
    // susturmaz. Hiç parti yoksa null → çeki bloğu basılmaz.
    const draftBatchNumbers = [
      ...new Set(projected.map((r) => r.batch?.batchNumber).filter((b): b is string => !!b)),
    ].sort();

    const doc = assembleFasonCekiDoc({
      dispatchNo: "(TASLAK)",
      dispatchedAt: new Date().toISOString(),
      driverName: null,
      plateNumber: null,
      notes: null,
      instruction: step.notes ?? null,
      workOrder: {
        id: step.workOrder.id,
        workOrderNumber: step.workOrder.workOrderNumber,
        parameters: (step.workOrder.parameters as Record<string, unknown> | null) ?? null,
        type: step.workOrder.type,
        width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
      },
      subcontractor: {
        id: step.plannedSubcontractor.id,
        name: step.plannedSubcontractor.name,
        code: step.plannedSubcontractor.code ?? null,
      },
      requestedColor: step.workOrder.targetColor?.name ?? null,
      targetProperties: step.workOrder.targetProperties.map((p) => p.property.name),
      // ⚠️ TASLAK da GERÇEK sevkle AYNI yardımcıdan beslenir — ayrışırsa
      // planlamacının önizlemede gördüğü talimat ile boyahaneye giden kâğıt
      // sessizce farklı olur (bu belgede iki üreticinin ortak kuralı).
      commands: {
        color: resolveStepDyeColor(step, step.workOrder.targetColor?.name ?? null),
        works: await resolveStepWorkInstructions(
          prisma,
          step.stationId,
          step.workOrder.targetProperties.map((p) => ({ propertyId: p.propertyId, name: p.property.name })),
        ),
      },
      batchNumber: draftBatchNumbers.length ? draftBatchNumbers.join(", ") : null,
      step: {
        id: step.id,
        stepSequence: step.stepSequence,
        station: { name: step.station.name, code: step.station.code },
      },
      rolls,
      totalQty,
    });

    const html = await printedDocumentService.renderDraftHtml(
      PrintedDocType.SUBCONTRACTOR_DISPATCH,
      doc
    );
    return { success: true, data: { html } };
  }

export async function updateInstruction(
    id: string,
    instruction: string | null,
    userId?: string
  ): Promise<ApiResponse<{ id: string; dispatchNo: string; instruction: string | null }>> {
    // Boş/whitespace → null (talimatı temizle).
    const next = instruction && instruction.trim() ? instruction.trim() : null;

    // Kilit koşulları (iptal edilmemiş + kabulsüz) claim'in WHERE'ine konur:
    // eskiden okuma ile yazma tx dışında ayrıydı ve o pencerede gelen bir iptal
    // ya da mal kabulü, kilitlenmiş bir sevkin talimatını değiştirtiyordu.
    const { updated, oldInstruction } = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.subcontractorDispatch.findUnique({
        where: { id },
        select: { id: true, workOrderId: true, instruction: true },
      });
      if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
      assertWorkOrderBound(dispatch); // fason talimatı iş emri sevkinin alanı

      const claimed = await tx.subcontractorDispatch.updateMany({
        where: {
          id,
          cancelledAt: null,
          // P4: bu sevkin (iptal edilmemiş) bir kabulü varsa fason firma malı
          // zaten işledi — talimatı değiştirmek anlamsız/yanıltıcı, kilitle.
          items: { none: { receiptItems: { some: { receipt: { cancelledAt: null } } } } },
        },
        data: { instruction: next },
      });
      if (claimed.count === 0) {
        // Tanı tx İÇİNDE taze okumayla — iki sebebin hangisi olduğu söylenmeli.
        const fresh = await tx.subcontractorDispatch.findUnique({
          where: { id },
          select: { cancelledAt: true },
        });
        throw AppError.conflict(
          fresh?.cancelledAt
            ? "İptal edilmiş sevkin fason talimatı düzenlenemez"
            : "Mal kabul edilmiş — fason talimatı artık düzenlenemez.",
        );
      }

      const row = await tx.subcontractorDispatch.findUniqueOrThrow({
        where: { id },
        select: { id: true, dispatchNo: true, instruction: true },
      });
      return { updated: row, oldInstruction: dispatch.instruction };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: id,
      oldData: { instruction: oldInstruction },
      newData: { instruction: next },
    });

    return { success: true, data: updated };
  }
