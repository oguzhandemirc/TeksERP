// =============================================================================
// TeksERP - Subcontractor (Fason) Service / direct-ship
// =============================================================================
// Fasondan doğrudan (müşteriye) sevk: önizleme + yürütme ve çocuk top bölme yardımcıları.
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_ROLL_PROPERTY, inheritRollPropertiesTx } from "../helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { withBarcodeRetry } from "../../utils/barcode-retry";
import { openLineWhere } from "../helpers/order-line-scope.helper";
import { resolveEntryStationId } from "../helpers/roll-entry-station.helper";
import { resolveTargetWarehouseId } from "../helpers/warehouse.helper";
import { ApiResponse } from "../../types/api.types";
import { Prisma, PrintedDocType, RollEntrySource, RollOperationType, RollStage, RollStatus, StationKind, StepStatus, ScanType } from "@prisma/client";
import { printedDocumentService } from "../printed-document.service";
import { nextSeriesNo } from "../number-series.service";
import { assertOwnerMatchesTx } from "../helpers/emanet-owner.helper";
import { completeWorkOrderIfStepsDone } from "../helpers/roll-step.helper";
import { generateRollBarcodeTx } from "../helpers/roll-barcode.helper";
import { recomputeOrderStatusForOrdersTx, touchOrderLinesTx } from "../helpers/order-status.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
// Fasondan doğrudan sevk önizlemesi karşılanma projeksiyonunu shipping'in saf
// FIFO/spec-eşleşmesiyle üretir (tek karşılanma kaynağı; circular yok — shipping
// subcontractor'ı import etmez).
import { allocate, specMatch, type RollSpec, type LineForAlloc } from "../helpers/allocation.helper";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import {
  assertOrderLinkAllowed,
  resolveOrderRequirement,
} from "../helpers/shipment-order-requirement.helper";
import { hata } from "../../lib/logger";
import { hasRoll, isRollItem } from "../helpers/dispatch-item-kind.helper";
import { TERIM } from "../../constants/terim";
import { logTravelerScan } from "./receive";

// -----------------------------------------------------------------------------
// Service
// -----------------------------------------------------------------------------

/**
 * Fasonda (AT_SUBCONTRACTOR) bir topun KISMİ metrajını sevk için çocuk top yaratır —
 * cutWarehouseRoll deseninin fason-adım uyarlaması. Çocuk = sevk edilen metre (yeni
 * barkod, parent+parti+kalite+özellik+kurşun/QC2 kalıtımı, fason adımında AT_SUBCONTRACTOR,
 * IN-movement). Orijinal atomik decrement ile kalan metreye iner (fasonda AT_SUBCONTRACTOR
 * kalır, barkodu korunur). Döner: çocuk top id — çağıran onu consume/operation akışına besler.
 */
async function createFasonShipChild(
  tx: Prisma.TransactionClient,
  parent: {
    id: string;
    itemId: string;
    colorId: string | null;
    width: Prisma.Decimal | null;
    qualityGrade: string | null;
    qualityGradeId: string | null;
    batchId: string | null;
    /** Çocuğun mirasla alacağı depo (kısmi sevk topu BÖLER, taşımaz). */
    warehouseId: string | null;
    /** EMANET sahipliği doğum niteliği — müşterinin kumaşından bölünen parça da onundur (H10). */
    ownerCustomerId: string | null;
    /** Top aşaması — kısmi sevk çocuğu atanın aşamasını alır (aynı mal, bölündü). */
    stage: RollStage;
  },
  shipQty: number,
  stepId: string,
  userId?: string,
  /**
   * Sevk adımının istasyonu — çocuğun GİRİŞ İSTASYONU damgası.
   * Çağıran zaten `dispatch.step.stationId`i select ediyor; buraya geçirmemek
   * damganın sessizce NULL kalması demekti.
   */
  stepStationId?: string | null,
): Promise<string> {
  const barcode = await generateRollBarcodeTx(tx, "H");
  const props = await tx.rollProperty.findMany({
    where: { rollId: parent.id, ...ACTIVE_ROLL_PROPERTY },
    // valueId: kısmi-sevk çocuğu ebeveynin değer seçimini de devralır (denetim F6).
    select: { propertyId: true, valueId: true },
  });
  const child = await tx.roll.create({
    data: {
      barcode,
      itemId: parent.itemId,
      colorId: parent.colorId,
      width: parent.width,
      // DEPO parent'tan MİRAS ALINIR: kısmi sevkte top BÖLÜNÜR, taşınmaz — kalan
      // parça ebeveynin durduğu depodadır. Sorgu yalnız ebeveyn deposuz ise koşar.
      warehouseId: parent.warehouseId ?? (await resolveTargetWarehouseId(tx)),
      initialQty: shipQty,
      currentQty: shipQty,
      status: RollStatus.AT_SUBCONTRACTOR,
      currentStepId: stepId,
      qualityGrade: parent.qualityGrade,
      qualityGradeId: parent.qualityGradeId,
      parentRollId: parent.id,
      ownerCustomerId: parent.ownerCustomerId,
      batchId: parent.batchId,
      entrySource: RollEntrySource.TAMBUR_SPLIT,
      stage: parent.stage,
      createdById: userId ?? null,
      entryStationId: resolveEntryStationId({ stepStationId }),
    },
  });
  if (props.length > 0) {
    // Doğum-anı damgalı miras (geri kurulum donörü bunu sayar).
    await inheritRollPropertiesTx(tx, { childId: child.id, rows: props });
  }
  const ops = await tx.rollOperation.findMany({
    where: { ...ACTIVE_OPERATION,
      rollId: parent.id,
      operationType: { in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED] },
    },
    select: {
      workOrderStepId: true,
      operationType: true,
      operatorId: true,
      metadata: true,
      machineId: true,
      propertyValueId: true,
    },
  });
  if (ops.length > 0) {
    await tx.rollOperation.createMany({
      data: ops.map((op) => ({
        rollId: child.id,
        workOrderStepId: op.workOrderStepId,
        operationType: op.operationType,
        operatorId: op.operatorId,
        machineId: op.machineId,
        metadata: (op.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        propertyValueId: op.propertyValueId, // KQ-D4: gramaj mirası
        inheritedFromParentRollId: parent.id,
      })),
      skipDuplicates: true,
    });
  }
  // Çocuğa fason adım hareketi (IN) — directShip movement-close bunu DIRECT_SHIP notuyla kapatır.
  await tx.rollMovement.create({
    data: { rollId: child.id, workOrderStepId: stepId, qtyIn: shipQty, enteredAt: new Date() },
  });
  // Orijinali atomik decrement: kalan metreye in, fasonda AT_SUBCONTRACTOR kal.
  // ⚠️ YALNIZ `currentQty` düşer — `initialQty` ÜRETİM ANI SNAPSHOT'ıdır, gösterim
  // değil; düşürmek WO üretilen metrajını geriye azaltır ve `rollWhole` kapısını
  // deler (aynı yasak ve üç kusuru: `tambur.service.ts` parent-kısalma bloğu).
  const dec = await tx.roll.updateMany({
    where: { id: parent.id, status: RollStatus.AT_SUBCONTRACTOR, currentQty: { gte: shipQty } },
    data: { currentQty: { decrement: shipQty } },
  });
  if (dec.count !== 1) {
    throw AppError.conflict("Top bu sırada değişti — kısmi sevk yapılamadı. Listeyi yenileyin.");
  }
  return child.id;
}

/**
 * Doğrudan sevkte kısmi metrajlı topları böler. Döner: sevk edilecek EFEKTİF top id'leri
 * (tam sevk → orijinal id, kısmi sevk → çocuk id) + herhangi bir bölme oldu mu. rollShipQtys
 * yoksa/boşsa aynı liste (tam sevk). Metre kalanı aşıyorsa/eşitse tam sevk sayılır.
 */
async function applyDirectShipSplits(
  tx: Prisma.TransactionClient,
  shipRollIds: string[],
  rollShipQtys: Record<string, number> | undefined,
  stepId: string,
  userId?: string,
  /** Sevk adiminin istasyonu — bolunen cocuklarin giris istasyonu damgasi. */
  stepStationId?: string | null,
): Promise<{ effectiveShipRollIds: string[]; anySplit: boolean }> {
  if (!rollShipQtys || Object.keys(rollShipQtys).length === 0) {
    return { effectiveShipRollIds: shipRollIds, anySplit: false };
  }
  const rolls = await tx.roll.findMany({
    where: { id: { in: shipRollIds } },
    select: {
      id: true,
      itemId: true,
      colorId: true,
      width: true,
      qualityGrade: true,
      qualityGradeId: true,
      batchId: true,
      currentQty: true,
      ownerCustomerId: true,
      stage: true,
      // Çocuk depoyu ebeveynden miras alır — select'ten düşerse derleme kırılır
      // (createFasonShipChild parametre tipi bunu ZORUNLU tutar).
      warehouseId: true,
    },
  });
  const byId = new Map(rolls.map((r) => [r.id, r]));
  const effective: string[] = [];
  let anySplit = false;
  for (const rid of shipRollIds) {
    const roll = byId.get(rid);
    const q = rollShipQtys[rid];
    if (!roll || q == null || q >= Number(roll.currentQty)) {
      effective.push(rid); // tam sevk (ya da qty verilmemiş)
      continue;
    }
    if (!(q > 0)) throw AppError.badRequest("Sevk metresi pozitif olmalı");
    anySplit = true;
    effective.push(await createFasonShipChild(tx, roll, q, stepId, userId, stepStationId));
  }
  return { effectiveShipRollIds: effective, anySplit };
}

/** Sonraki DirectShipment numarası (DSK + GGAAYY + NNNN) — tx içinde bugünkü max'tan. */
async function nextDirectShipmentNo(tx: Prisma.TransactionClient): Promise<string> {
  return nextSeriesNo("directShipment", async (prefix) => {
    const todays = await tx.directShipment.findMany({
      where: { shipmentNo: { gte: prefix, startsWith: prefix } },
      select: { shipmentNo: true, createdAt: true },
    });
    return todays.map((s) => ({ code: s.shipmentNo, createdAt: s.createdAt }));
  });
}

export async function previewDirectShip(dispatchId: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        subcontractor: { select: { id: true, name: true } },
        step: {
          select: {
            id: true,
            stepSequence: true,
            station: { select: { name: true, kind: true } },
            workOrder: {
              select: {
                id: true,
                workOrderNumber: true,
                status: true,
                steps: {
                  select: {
                    id: true,
                    stepSequence: true,
                    status: true,
                    station: { select: { name: true } },
                  },
                  orderBy: { stepSequence: "asc" },
                },
                orderLinks: {
                  where: ACTIVE_ORDER_LINK,
                  select: {
                    orderLine: {
                      select: {
                        id: true,
                        itemId: true,
                        colorId: true,
                        width: true,
                        quantity: true,
                        shippedQty: true,
                        item: { select: { code: true, name: true } },
                        color: { select: { name: true } },
                        order: {
                          select: {
                            id: true,
                            orderNumber: true,
                            status: true,
                            orderDate: true,
                            deadline: true,
                            customer: { select: { id: true, name: true } },
                            branch: { select: { id: true, name: true } },
                          },
                        },
                        createdAt: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        items: {
          select: {
            rollId: true,
            roll: {
              select: {
                id: true,
                barcode: true,
                currentQty: true,
                weightKg: true,
                width: true,
                status: true,
                currentStepId: true,
                itemId: true,
                colorId: true,
                item: { select: { code: true, name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWorkOrderBound(dispatch); // DSK önizlemesi yalnız iş emri sevki

    const step = dispatch.step;
    const wo = step.workOrder;

    // Etkilenecek toplar: bu sevkte HÂLÂ fasonda olanlar.
    const affectedRolls = dispatch.items
      .filter(hasRoll)
      .filter((it) => it.roll.status === RollStatus.AT_SUBCONTRACTOR && it.roll.currentStepId === step.id)
      .map((it) => ({
        id: it.roll.id,
        barcode: it.roll.barcode,
        currentQty: Number(it.roll.currentQty),
        weightKg: it.roll.weightKg != null ? Number(it.roll.weightKg) : null,
        itemCode: it.roll.item?.code ?? "",
        itemName: it.roll.item?.name ?? "",
        colorName: it.roll.color?.name ?? null,
      }));

    // SKIPPED olacak downstream adımlar (fason fiilen son durak).
    const downstreamStepsToSkip = wo.steps
      .filter(
        (s) =>
          s.stepSequence > step.stepSequence &&
          (s.status === StepStatus.PENDING || s.status === StepStatus.ACTIVE),
      )
      .map((s) => ({ id: s.id, stepSequence: s.stepSequence, stationName: s.station.name }));

    // Bu adımda BAŞKA sevkten kalan fason topu (çoklu açık dispatch) — varsa adım
    // ve WO bu işlemle tamamlanmaz.
    const otherAtSubcontractor = await prisma.roll.count({
      where: {
        currentStepId: step.id,
        status: RollStatus.AT_SUBCONTRACTOR,
        id: { notIn: affectedRolls.map((r) => r.id) },
      },
    });
    const skipIds = new Set(downstreamStepsToSkip.map((s) => s.id));
    const remainingNonTerminal = wo.steps.filter(
      (s) =>
        s.id !== step.id &&
        !skipIds.has(s.id) &&
        s.status !== StepStatus.COMPLETED &&
        s.status !== StepStatus.SKIPPED,
    );
    const woWillComplete = otherAtSubcontractor === 0 && remainingNonTerminal.length === 0;

    // Aday sipariş satırları — WO'ya bağlı satırlar + spec-eşleşen açık satırlar.
    // suggestedQty shipping'in saf FIFO'suyla (allocate) projeksiyon.
    const rollSpecs: RollSpec[] = affectedRolls.map((r) => {
      const src = dispatch.items.filter(hasRoll).find((it) => it.roll.id === r.id)!.roll;
      return {
        itemId: src.itemId,
        colorId: src.colorId,
        width: src.width,
        currentQty: new Prisma.Decimal(r.currentQty),
      };
    });
    const itemIds = [...new Set(rollSpecs.map((s) => s.itemId))];

    // WO-bağlı satırlar + aynı item'da açık (eksik) diğer satırlar.
    const linkedLineIds = new Set(
      wo.orderLinks.map((l) => l.orderLine).filter(Boolean).map((ol) => ol!.id),
    );
    const otherOpenLines =
      itemIds.length > 0
        ? await prisma.orderLine.findMany({
            where: {
              itemId: { in: itemIds },
              id: { notIn: [...linkedLineIds] },
              order: { status: { notIn: ["CANCELLED", "COMPLETED"] } },
              // Aktif + açık kalem — tek kaynak (iptal edilmiş kaleme fasondan
              // doğrudan sevk tahsis edilemez).
              ...openLineWhere(prisma.orderLine.fields),
            },
            select: {
              id: true,
              itemId: true,
              colorId: true,
              width: true,
              quantity: true,
              shippedQty: true,
              item: { select: { code: true, name: true } },
              color: { select: { name: true } },
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  status: true,
                  orderDate: true,
                  deadline: true,
                  customer: { select: { id: true, name: true } },
                  branch: { select: { id: true, name: true } },
                },
              },
              createdAt: true,
            },
            take: 50,
          }).catch((e) => {
            // Önizleme degrade etsin (öneri yine de WO'nun kendi satırlarıyla
            // dönsün) AMA hata SESSİZ kalmasın — DB/timeout hatası loglanır.
            hata("previewDirectShip", "otherOpenLines sorgusu başarısız:", e);
            return [];
          })
        : [];

    const rawLines = [
      ...wo.orderLinks.map((l) => l.orderLine).filter(Boolean).map((ol) => ol!),
      ...otherOpenLines,
    ];
    // Spec-eşleşen ve karşılanmaya yer olan (remaining>0) satırları al. Kapasite =
    // quantity − shippedQty (§5).
    const matchingLines = rawLines.filter(
      (ol) =>
        rollSpecs.some((rs) =>
          specMatch(
            { itemId: rs.itemId, colorId: rs.colorId, width: rs.width },
            { itemId: ol.itemId, colorId: ol.colorId, width: ol.width },
          ),
        ) && new Prisma.Decimal(ol.quantity).greaterThan(new Prisma.Decimal(ol.shippedQty)),
    );
    // allocate need = quantity − shippedQty.
    const linesForAlloc: LineForAlloc[] = matchingLines.map((ol) => ({
      id: ol.id,
      itemId: ol.itemId,
      colorId: ol.colorId,
      width: ol.width,
      quantity: new Prisma.Decimal(ol.quantity),
      shippedQty: new Prisma.Decimal(ol.shippedQty),
      deadline: ol.order.deadline,
      orderDate: ol.order.orderDate,
      lineCreatedAt: ol.createdAt,
    }));
    const suggested = allocate(rollSpecs, linesForAlloc);
    const candidateOrderLines = matchingLines.map((ol) => ({
      orderLineId: ol.id,
      orderId: ol.order.id,
      orderNumber: ol.order.orderNumber,
      // Müşteri + şube — frontend seçilen müşteriye göre daraltır ve satırda gösterir.
      customerId: ol.order.customer?.id ?? null,
      customerName: ol.order.customer?.name ?? null,
      branchId: ol.order.branch?.id ?? null,
      branchName: ol.order.branch?.name ?? null,
      itemCode: ol.item.code,
      itemName: ol.item.name,
      colorName: ol.color?.name ?? null,
      width: ol.width != null ? Number(ol.width) : null,
      quantity: Number(ol.quantity),
      shippedQty: Number(ol.shippedQty),
      remaining: Number(new Prisma.Decimal(ol.quantity).minus(ol.shippedQty)),
      suggestedQty: suggested.has(ol.id) ? Number(suggested.get(ol.id)!) : 0,
      isWorkOrderLinked: linkedLineIds.has(ol.id),
    }));

    return {
      success: true,
      data: {
        dispatchId,
        dispatchNo: dispatch.dispatchNo,
        cancelled: dispatch.cancelledAt != null,
        alreadyDirectShipped: dispatch.directShippedAt != null,
        subcontractor: dispatch.subcontractor,
        workOrder: { id: wo.id, batchNumber: wo.workOrderNumber, status: wo.status },
        fasonStep: { id: step.id, stepSequence: step.stepSequence, stationName: step.station.name },
        affectedRolls,
        downstreamStepsToSkip,
        otherAtSubcontractor,
        woWillComplete,
        candidateOrderLines,
      },
    };
  }

export async function executeDirectShip(
    data: {
      dispatchId: string;
      reason: string;
      /** Sevk edilecek topların alt-kümesi (yok/boş = sevkin TÜMÜ). Seçilmeyenler
       *  AT_SUBCONTRACTOR kalır → normal fason kabulüyle fabrikaya döner. */
      rollIds?: string[];
      /** Kısmi metraj: topId → sevk metre. Topun kalanından azsa top bölünür
       *  (çocuk = sevk edilen, orijinal = kalan, fasonda AT_SUBCONTRACTOR kalır). */
      rollShipQtys?: Record<string, number>;
      /** Mal KİME gitti — DirectShipment kaydı + irsaliye için ZORUNLU. */
      customerId?: string;
      branchId?: string;
      /** true → fason fiilen son durak: kalan adımlar SKIPPED + WO COMPLETED.
       *  false (default) → sadece toplar sevk edilir, WO açık kalır (kalan üretim devam). */
      completeWorkOrder?: boolean;
      orderLineAllocations?: Array<{ orderLineId: string; qty: number }>;
      /** "Bu mal bilerek siparişsiz gidiyor" beyanı — `shipping.orderRequirement`
       *  `block` rejiminin KAÇIŞ KAPISI. Fason doğrudan sevk çoğu zaman son
       *  duraktır (numune / kalan mal) ve kapı kaçışsız kalırsa o akış tamamen
       *  kilitlenirdi. Kural "sipariş seç" değil "ne yaptığını söyle"dir. */
      orderless?: boolean;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const trimmedReason = data.reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("Fasondan sevk sebebi en az 3 karakter olmalı");
    }
    if (!data.customerId) {
      throw AppError.badRequest("Fasondan sevkte müşteri zorunludur (mal kime gitti?)");
    }
    const completeWorkOrder = data.completeWorkOrder === true;

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: data.dispatchId },
      include: {
        items: { select: { rollId: true } },
        step: {
          select: {
            id: true,
            stepSequence: true,
            stationId: true,
            workOrderId: true,
            station: { select: { kind: true } },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    assertWorkOrderBound(dispatch); // DSK yalnız iş emri sevkinden (top sevki)
    if (dispatch.cancelledAt) throw AppError.conflict("İptal edilmiş sevk fasondan sevk edilemez");
    if (dispatch.directShippedAt) {
      // Idempotency: zaten doğrudan sevk edilmiş → cached başarı.
      return {
        success: true,
        data: { id: dispatch.id, dispatchNo: dispatch.dispatchNo, alreadyDirectShipped: true },
        message: `Sevk zaten doğrudan sevk edilmiş: ${dispatch.dispatchNo}`,
      };
    }
    if (dispatch.step.station.kind !== StationKind.SUBCONTRACTOR) {
      throw AppError.badRequest("Fasondan sevk yalnızca fason adımındaki sevkler için yapılabilir");
    }

    // Kabul edilmiş sevk doğrudan sevk edilemez (cancel'daki acceptedReceiptItem deseni).
    const acceptedReceiptItem = await prisma.subcontractorReceiptItem.findFirst({
      where: { sourceDispatchItem: { is: { dispatchId: data.dispatchId } }, receipt: { cancelledAt: null } },
      select: { receipt: { select: { receiptNo: true } } },
    });
    if (acceptedReceiptItem?.receipt) {
      throw AppError.conflict(
        `Mal kabul yapılmış sevk doğrudan sevk edilemez (kabul: ${acceptedReceiptItem.receipt.receiptNo}).`,
      );
    }

    const dispatchRollIds = dispatch.items.filter(isRollItem).map((i) => i.rollId);
    // Sevk edilecek toplar: alt-küme verildiyse doğrula, yoksa tümü.
    let shipRollIds = dispatchRollIds;
    if (data.rollIds && data.rollIds.length > 0) {
      const dispatchSet = new Set(dispatchRollIds);
      if (data.rollIds.some((id) => !dispatchSet.has(id))) {
        throw AppError.badRequest("Seçilen toplardan bazıları bu sevke ait değil");
      }
      shipRollIds = [...new Set(data.rollIds)];
    }
    if (shipRollIds.length === 0) {
      throw AppError.badRequest("Sevk edilecek en az bir top seçilmeli");
    }

    // Defansif: sevk edilecek toplar hâlâ AT_SUBCONTRACTOR + bu adımda olmalı.
    const movedRolls = await prisma.roll.findMany({
      where: {
        id: { in: shipRollIds },
        OR: [
          { status: { not: RollStatus.AT_SUBCONTRACTOR } },
          { currentStepId: { not: dispatch.stepId } },
        ],
      },
      select: { id: true, barcode: true, status: true },
    });
    if (movedRolls.length > 0) {
      throw AppError.conflict(
        `${movedRolls.length} top fason sevkten sonra taşınmış veya statüsü değişmiş — doğrudan sevk edilemez.`,
        { code: "ROLLS_MOVED_PAST_DISPATCH", movedRolls },
      );
    }

    // Bu sevk, dispatch'in TÜM (hâlâ fasonda) toplarını mı kapsıyor? Kısmi sevkte
    // dispatch AÇIK kalır (kalan toplar normal kabulle döner), directShippedAt
    // SET EDİLMEZ, donmuş belge üretilmez (belge tüm dispatch'i gösterir).
    // Karar TX İÇİNDE, WO kilidi altında TAZE sayımla verilir (F72 — aşağıda);
    // tx-DIŞI bayat sayım eşzamanlı receive()'in döndürdüğü topları görmez → 'full'
    // olması gereken sevk 'partial' hesaplanıp directShippedAt set edilmez / belge donmaz.
    let isFullDispatchShip = false;
    // Oluşturulan DirectShipment no'su — tx dışına (return) taşımak için.
    let createdShipmentNo: string | null = null;

    // Opsiyonel karşılanma doğrulaması (verilmişse).
    const allocations = data.orderLineAllocations ?? [];
    /** Tahsislerin dokunduğu SİPARİŞLER — sipariş bağı kapısının girdisi. */
    const allocOrderIds = new Set<string>();
    if (allocations.length > 0) {
      const rollSpecs = await prisma.roll.findMany({
        where: { id: { in: shipRollIds } },
        select: { itemId: true, colorId: true, width: true },
      });
      const lineIds = allocations.map((a) => a.orderLineId);
      const lines = await prisma.orderLine.findMany({
        where: { id: { in: lineIds } },
        select: {
          id: true, itemId: true, colorId: true, width: true,
          quantity: true, shippedQty: true,
          order: { select: { id: true, status: true } },
        },
      });
      const lineById = new Map(lines.map((l) => [l.id, l]));
      const seenLineIds = new Set<string>();
      for (const a of allocations) {
        // Aynı satır iki kez → @@unique([dispatchId, orderLineId]) P2002 olmadan 400.
        if (seenLineIds.has(a.orderLineId)) {
          throw AppError.badRequest("Aynı sipariş satırına iki kez karşılanma yazılamaz");
        }
        seenLineIds.add(a.orderLineId);
        if (!(a.qty > 0)) throw AppError.badRequest("Karşılanan metraj 0'dan büyük olmalı");
        const line = lineById.get(a.orderLineId);
        if (!line) throw AppError.badRequest(`Sipariş satırı bulunamadı: ${a.orderLineId}`);
        // Erken/ucuz reddetme — otoriter terminal+cap kontrolü tx İÇİNDE taze
        // veriyle yapılır (subcon #2).
        if (line.order.status === "CANCELLED") {
          throw AppError.badRequest("İptal edilmiş siparişe karşılanma yazılamaz");
        }
        // Aşırı-sevk koruması: karşılanma satırın KALAN kapasitesini aşamaz
        // (quantity − shippedQty).
        const remaining = new Prisma.Decimal(line.quantity).minus(line.shippedQty);
        if (new Prisma.Decimal(a.qty).greaterThan(remaining)) {
          throw AppError.badRequest(
            `Karşılanan metraj (${a.qty}) satırın kalan kapasitesini (${remaining.toString()}) aşıyor`,
          );
        }
        const matches = rollSpecs.some((rs) =>
          specMatch(
            { itemId: rs.itemId, colorId: rs.colorId, width: rs.width },
            { itemId: line.itemId, colorId: line.colorId, width: line.width },
          ),
        );
        if (!matches) {
          throw AppError.badRequest("Seçilen sipariş satırı bu sevkteki toplarla eşleşmiyor");
        }
        allocOrderIds.add(line.order.id);
      }
    }

    // ═══ SİPARİŞ BAĞI KAPISI — `createShipment`in İKİZİ, tx'ten ÖNCE ═══
    // Fason doğrudan sevk mal fabrikaya HİÇ girmeden müşteriye çıkar; sevkiyat
    // servisinden geçmez, yani `createShipment`e konan kapı buraya UZANMIYORDU
    // ve `block` rejimi bu yoldan sessizce atlatılabiliyordu (2026-09-03 canlı
    // ölçüm: 110 m mal, 0 sipariş bağıyla, 200 ile bina dışına çıktı).
    // ⚠️ İKİNCİ BİR YÜKLEM YAZILMAZ — kardeş bayrak `invoiceMode` da doğrudan
    // sevki aynı yardımcıyla kapsıyor; kural tek yerde yaşar.
    assertOrderLinkAllowed(await resolveOrderRequirement(), {
      orderIds: [...allocOrderIds],
      orderless: data.orderless,
    });

    // withBarcodeRetry: shipmentNo (@unique, DSK+GGAAYY+NNNN) tx içinde günün
    // max'ından üretiliyor (nextDirectShipmentNo); eşzamanlı iki doğrudan sevk
    // (farklı WO'lar — aynı WO'dakiler zaten touchWorkOrderTx kilidiyle serileşir)
    // aynı numarayı hesaplarsa kaybeden P2002 alırdı → tx BAŞTAN denenir, sıra
    // yeniden okunur (dispatch/receive'deki dispatchNo/receiptNo deseni). Retry
    // güvenli: tüm yarış guard'ları tx İÇİNDE atomik claim (directShippedAt,
    // AT_SUBCONTRACTOR count, satır-kilidi altında cap) — kaybeden retry'da
    // temiz commit edemez, anlamlı Türkçe 409'a düşer.
    await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — stillAtSubcontractor
      // sayımı + downstream SKIP eşzamanlı dispatch'le serileşsin.
      await touchWorkOrderTx(tx, dispatch.workOrderId);

      // VERİ BÜTÜNLÜĞÜ: "iş emrini tamamla" seçildiyse, sevk edilenler DIŞINDA WO'da
      // hâlâ üretimde/fasonda top varsa TAMAMLAMA. Aksi halde downstream adım SKIPPED
      // olduğunda o toplar sahipsiz kalırdı (SKIPPED adımda IN_PRODUCTION/AT_SUBCONTRACTOR,
      // WO COMPLETED). Erken 409 → sevk mutasyonundan ÖNCE tüm işlem rollback olur;
      // operatör "tamamla"yı kapatıp yalnız sevk eder ya da önce kalanları halleder.
      if (completeWorkOrder) {
        const otherInFlight = await tx.roll.count({
          where: {
            currentStep: { workOrderId: dispatch.workOrderId },
            status: { in: [RollStatus.IN_PRODUCTION, RollStatus.AT_SUBCONTRACTOR] },
            id: { notIn: shipRollIds },
          },
        });
        if (otherInFlight > 0) {
          throw AppError.conflict(
            `${TERIM.terbiyeIsEmri.cumleBasi.yalin} tamamlanamaz: sevk edilenler dışında ${otherInFlight} top hâlâ üretimde veya fasonda. ` +
              `Tamamlarsan bu toplar sahipsiz kalır — önce onları da sevk/kabul et ya da "${TERIM.terbiyeIsEmri.cekimKucuk.belirtme} tamamla"yı kapatıp yalnız sevk et.`,
            { code: "WO_HAS_ROLLS_IN_FLIGHT", inFlightCount: otherInFlight },
          );
        }
      }
      // ⚠️ DAMGA ÖLÇÜTÜ AŞAĞIDA, kalemlerin TOPUNDAN okunur. Eski ölçüt "hâlâ
      // fasonda kaç top var" sayımıydı ve İŞLEM SIRASINA bağlıydı: kardeş kalem
      // kalan-kapamasıyla kapandıysa sayım tutuyor ve damga basılıyordu, ters
      // sırada ise basılmıyordu — aynı fiziksel sonuç iki farklı belge durumu.

      // KISMİ SPLIT: sevk metresi topun kalanından azsa top bölünür (çocuk = sevk
      // edilen, orijinal = kalan, fasonda AT_SUBCONTRACTOR kalır). effectiveShipRollIds
      // = fiilen sevk/consume edilecek toplar (tam sevkler orijinal, kısmiler çocuk).
      const { effectiveShipRollIds, anySplit } = await applyDirectShipSplits(
        tx,
        shipRollIds,
        data.rollShipQtys,
        dispatch.stepId,
        userId,
        // Sevk adiminin istasyonu — zaten select edilmis, damga icin geciriliyor.
        dispatch.step?.stationId ?? null,
      );
      if (anySplit && completeWorkOrder) {
        throw AppError.badRequest(
          `Kısmi (bölünmüş) sevkte ${TERIM.terbiyeIsEmri.tekilKucuk} tamamlanamaz — kalan parça hâlâ fasonda.`,
        );
      }
      // 2) Açık RollMovement'leri kapat (DIRECT_SHIP notu).
      const tag = `DIRECT_SHIP:${dispatch.dispatchNo}`;
      await tx.$executeRaw`
        UPDATE "roll_movements" rm
        SET "qtyOut" = r."currentQty",
            "weightOut" = r."weightKg",
            -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
            "exitedAt" = now(),
            "notes" = CASE
              WHEN rm."notes" IS NULL OR rm."notes" = '' THEN ${tag}
              ELSE rm."notes" || ' | ' || ${tag}
            END
        FROM "rolls" r
        WHERE rm."rollId" = r."id"
          AND rm."workOrderStepId" = ${dispatch.stepId}::uuid
          AND rm."exitedAt" IS NULL
          AND rm."revokedAt" IS NULL
          AND rm."rollId" = ANY(${effectiveShipRollIds}::uuid[])
      `;

      // 2b) EMANET SAHİPLİK KAPISI (G3): fasondan müşteriye çıkış da "malın çıktığı yol"dur — başka
      //     müşterinin emanet topu bu müşteriye gidemez (409 OWNER_MISMATCH, barkodlarıyla).
      await assertOwnerMatchesTx(tx, { rollIds: effectiveShipRollIds, customerId: data.customerId!, belge: "fason doğrudan sevki" });

      // 3) Sevk edilen toplar TERMINAL: SUBCONTRACTOR_CONSUMED (gerçek sevk;
      //    batchId KORUNUR — receive deseni). Atomik claim. Seçilmeyen toplar
      //    AT_SUBCONTRACTOR kalır (normal kabulle döner).
      const consumed = await tx.roll.updateMany({
        where: { id: { in: effectiveShipRollIds }, status: RollStatus.AT_SUBCONTRACTOR },
        data: { status: RollStatus.SUBCONTRACTOR_CONSUMED, currentStepId: null },
      });
      if (consumed.count !== effectiveShipRollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle değişmiş. Listeyi yenileyip tekrar deneyin.",
        );
      }

      // DirectShipment kaydı — mal KİME gitti + hangi toplar. "Sevkiyatlar" birleşik
      // listesinde görünür; kısmi/çoklu sevkte olay-başına ayrı kayıt.
      const shippedRolls = await tx.roll.findMany({
        where: { id: { in: effectiveShipRollIds } },
        select: { currentQty: true },
      });
      const totalShippedQty = shippedRolls.reduce(
        (s, r) => s.plus(r.currentQty),
        new Prisma.Decimal(0),
      );
      const directShipment = await tx.directShipment.create({
        data: {
          shipmentNo: await nextDirectShipmentNo(tx),
          dispatchId: data.dispatchId,
          customerId: data.customerId!,
          branchId: data.branchId ?? null,
          reason: trimmedReason,
          totalQty: totalShippedQty,
          rollCount: effectiveShipRollIds.length,
          shippedById: userId ?? null,
        },
      });
      createdShipmentNo = directShipment.shipmentNo;
      await tx.roll.updateMany({
        where: { id: { in: effectiveShipRollIds } },
        data: { directShipmentId: directShipment.id },
      });

      // Dispatch işareti: sevkin TÜM kalemlerinin topu müşteriye çıktıysa damga
      // basılır (atomik claim). Ölçüt kalemlerin topundan okunur — kalan-kapaması
      // ya da kabul görmüş bir kalem varsa sevk "tamamen müşteriye çıkmış" DEĞİLDİR
      // ve damga İŞLEM SIRASINDAN bağımsız olarak basılmaz. Bölünmede ebeveyn
      // kalem fasonda kaldığı için ölçüt kendiliğinden false verir.
      // ⚠️ ÖLÇÜT `ownDirectShip` İKİZİDİR (karne sorgusu): topun DSK'sı BU sevke
      // ait olmalı; başka sevkten çıkmış top bu sevkin teslimi değildir.
      const notDelivered = await tx.subcontractorDispatchItem.count({
        where: {
          dispatchId: data.dispatchId,
          roll: {
            OR: [
              { directShipmentId: null },
              { directShipment: { dispatchId: { not: data.dispatchId } } },
            ],
          },
        },
      });
      isFullDispatchShip = notDelivered === 0;
      if (isFullDispatchShip) {
        const claim = await tx.subcontractorDispatch.updateMany({
          where: { id: data.dispatchId, directShippedAt: null, cancelledAt: null },
          data: {
            directShippedAt: new Date(),
            directShippedById: userId ?? null,
            directShipReason: trimmedReason,
          },
        });
        if (claim.count === 0) {
          throw AppError.conflict("Bu sevk az önce başka bir işlemle değişmiş. Listeyi yenileyin.");
        }
      }

      // 4) RollOperation log (SUBCONTRACTOR_RETURNED + directShip metadata).
      await tx.rollOperation.createMany({
        data: effectiveShipRollIds.map((rid) => ({
          rollId: rid,
          workOrderStepId: dispatch.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
          operatorId: userId ?? null,
          metadata: {
            directShip: true,
            dispatchNo: dispatch.dispatchNo,
            reason: trimmedReason,
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });

      // 5) Adım kapanışı: bu adımda başka fason topu kalmadıysa adım COMPLETED.
      //    (Kısmi sevkte seçilmeyen toplar AT_SUBCONTRACTOR kaldığından adım ACTIVE
      //    kalır; çoklu açık dispatch'te de aynı.)
      const stillAtSubcontractor = await tx.roll.count({
        where: { currentStepId: dispatch.stepId, status: RollStatus.AT_SUBCONTRACTOR },
      });
      if (stillAtSubcontractor === 0) {
        await tx.workOrderStep.update({
          where: { id: dispatch.stepId },
          data: { status: StepStatus.COMPLETED, completedAt: new Date() },
        });

        // WO'yu TAMAMLA + kalan adımları ATLA — YALNIZ operatör "iş emrini tamamla"
        // dediyse (completeWorkOrder). Aksi halde downstream adımlar PENDING + WO
        // IN_PROGRESS kalır: kalan üretim devam eder (operatör sonra daha çok top
        // gönderebilir; fason adımı yeni sevkte yeniden açılır).
        if (completeWorkOrder) {
          await tx.$executeRaw`
            UPDATE "roll_movements"
            -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
            SET "exitedAt" = now(),
                "notes" = CASE WHEN "notes" IS NULL OR "notes" = '' THEN 'FASON_DIRECT_SHIP'
                               ELSE "notes" || ' | FASON_DIRECT_SHIP' END
            WHERE "workOrderStepId" IN (
              SELECT "id" FROM "work_order_steps"
              WHERE "workOrderId" = ${dispatch.workOrderId}::uuid
                AND "stepSequence" > ${dispatch.step.stepSequence}
                AND "status" IN ('PENDING','ACTIVE')
            ) AND "exitedAt" IS NULL
              AND "revokedAt" IS NULL
          `;
          await tx.workOrderStep.updateMany({
            where: {
              workOrderId: dispatch.workOrderId,
              stepSequence: { gt: dispatch.step.stepSequence },
              status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] },
            },
            data: { status: StepStatus.SKIPPED, skipReason: "FASON_DIRECT_SHIP" },
          });

          // Adım sayımı + kart geçişi helper'ın içinde; terminal guard da orada.
          await completeWorkOrderIfStepsDone(tx, dispatch.workOrderId, { trigger: "FASON_DIRECT_SHIP" });
        }
      }

      // 6) Opsiyonel karşılanma (commitGoodsTx aynası — yeni alloc tablosuna).
      if (allocations.length > 0) {
        // OVER-COVER guard (subcon #2): kapasite (3081) tx DIŞINDA okundu → iki paralel
        // directShip aynı satırı bayat cap'le aşabilirdi (shippedQty > quantity). Satırları
        // kilitle, TAZE shippedQty/quantity/status oku ve cap'i tx İÇİNDE yeniden doğrula.
        const allocLineIds = allocations.map((a) => a.orderLineId);
        // Kilit, tahsisli satırlardan TAM sipariş-satır kümesine genişletildi:
        // recompute (4454) siparişin TÜM satırlarını yazar; alt-küme kilidi,
        // dispatch/cancelShipment'ın tam-küme kilidiyle kesişince iki-parti
        // edinim → deadlock penceresi doğururdu (order-status.helper protokolü).
        // orderId satırın değişmez alanı — kilitsiz okunabilir.
        const allocLineOrders = await tx.orderLine.findMany({
          where: { id: { in: allocLineIds } },
          select: { orderId: true },
        });
        const lockOrderIds = [...new Set(allocLineOrders.map((l) => l.orderId))];
        const allOrderLines = await tx.orderLine.findMany({
          where: { orderId: { in: lockOrderIds } },
          select: { id: true },
        });
        await touchOrderLinesTx(tx, allOrderLines.map((l) => l.id));
        const freshLines = await tx.orderLine.findMany({
          where: { id: { in: allocLineIds } },
          select: {
            id: true,
            quantity: true,
            shippedQty: true,
            order: {
              select: {
                id: true,
                status: true,
                manualClosedById: true,
                customerId: true,
                branchId: true,
              },
            },
          },
        });
        const freshById = new Map(freshLines.map((l) => [l.id, l]));
        const orderIds = new Set<string>();
        for (const a of allocations) {
          const line = freshById.get(a.orderLineId);
          if (!line) throw AppError.notFound(`Sipariş satırı bulunamadı: ${a.orderLineId}`);
          // Karşılanma yalnız SEÇİLEN müşterinin (ve şube seçildiyse o şubenin) siparişine
          // yazılabilir — mal o müşteriye/şubeye gidiyor; başkasına karşılanma saçma olur
          // (frontend zaten daraltıyor, bu defense-in-depth).
          if (data.customerId && line.order.customerId !== data.customerId) {
            throw AppError.badRequest(
              "Karşılanan sipariş satırı seçilen müşteriye ait değil — yalnız o müşterinin siparişleri işlenebilir.",
            );
          }
          if (data.branchId && line.order.branchId !== data.branchId) {
            throw AppError.badRequest(
              "Karşılanan sipariş satırı seçilen şubeye ait değil — yalnız o şubenin siparişleri işlenebilir.",
            );
          }
          if (
            line.order.status === "CANCELLED" ||
            (line.order.status === "COMPLETED" && line.order.manualClosedById != null)
          ) {
            throw AppError.conflict(
              "Sipariş bu sırada kapatıldı/iptal edildi — karşılanma yazılamaz, yenileyin",
            );
          }
          // Kapasite = quantity − shippedQty (fason doğrudan sevk over-supply
          // olmasın; §5).
          const remaining = new Prisma.Decimal(line.quantity).minus(line.shippedQty);
          if (new Prisma.Decimal(a.qty).greaterThan(remaining)) {
            throw AppError.conflict(
              `Karşılanan metraj (${a.qty}) satırın kalan kapasitesini (${remaining.toString()}) aştı — ` +
                "başka bir sevk/çuvallama bu satırı bu sırada doldurmuş olabilir, yenileyip tekrar deneyin",
            );
          }
          // Defter kaydı — shippedQty denorm'unu recompute (aşağıda) DirectShipAllocation'dan
          // türetir; manuel increment YAPILMAZ (çift sayım olurdu).
          await tx.subcontractorDirectShipAllocation.create({
            data: {
              dispatchId: data.dispatchId,
              directShipmentId: directShipment.id,
              orderLineId: a.orderLineId,
              qty: new Prisma.Decimal(a.qty),
            },
          });
          orderIds.add(line.order.id);
        }
        await recomputeOrderStatusForOrdersTx(tx, [...orderIds]);
      }

      // 7) Donmuş resmi belge — her doğrudan sevk OLAYI (tam VEYA kısmi) kendi
      //    irsaliyesini dondurur. sourceId = DirectShipment.id (dispatch DEĞİL):
      //    bir dispatch'ten birden çok kısmi doğrudan sevk çıkabilir, her biri ayrı
      //    belge; belge yalnız O olayın toplarını gösterir (kısmi sevkte doğru).
      await printedDocumentService.freezeForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP,
        directShipment.id,
        userId,
      );

      // 8) Refakat kartı INFO scan.
      await logTravelerScan(
        tx,
        dispatch.workOrderId,
        dispatch.step.stationId,
        dispatch.stepId,
        ScanType.INFO,
        userId,
        `Fasondan sevk: ${dispatch.dispatchNo} — ${trimmedReason}`,
      );
      })
    );

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: data.dispatchId,
      newData: {
        kind: "DIRECT_SHIP",
        reason: trimmedReason,
        consumedRollCount: shipRollIds.length,
        partialShip: !isFullDispatchShip,
        completeWorkOrder,
        allocatedOrderLineCount: allocations.length,
        manualOverride: true,
      },
    });

    return {
      success: true,
      data: {
        id: data.dispatchId,
        dispatchNo: dispatch.dispatchNo,
        directShipmentNo: createdShipmentNo,
        consumedRollCount: shipRollIds.length,
        partialShip: !isFullDispatchShip,
        workOrderCompleted: completeWorkOrder,
      },
      message: `Fasondan sevk edildi: ${dispatch.dispatchNo} (${shipRollIds.length} top)`,
    };
  }
