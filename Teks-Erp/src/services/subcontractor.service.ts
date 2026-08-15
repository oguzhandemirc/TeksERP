// =============================================================================
// TeksERP - Subcontractor (Fason) Service
// =============================================================================
// İş Kuralı:
//   - EXTERNAL station step'lerinde toplar operator tarafından START/FINISH
//     yapılamaz. Yerine şu iki uç nokta kullanılır:
//       * dispatch(): Seçilen toplar fasona sevk edilir. Step ACTIVE olur.
//                     Roll.status → AT_SUBCONTRACTOR. Refakat kartı DEPARTURE.
//       * receive() : Fasondan gelen fiziksel toplar irsaliye+göz kontrolü ile
//                     yeni barkodlarla sisteme alınır. Eski dispatch'e giren
//                     toplar RETURNED_FROM_SUBCONTRACTOR'a çekilir ve kapanır.
//                     Yeni toplar sonraki step'e taşınır, fire/çekme hesaplanır.
//                     Step COMPLETED olur. Refakat kartı ARRIVAL.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { sackBlockMessage } from "./helpers/sack-invariants.helper";
import { resolveEntryStationId } from "./helpers/roll-entry-station.helper";
import { v4 as uuidv4 } from "uuid";
import { ApiResponse } from "../types/api.types";
import {
  assertBatchInWorkOrder,
  createBatchTx,
  deleteIfEmptyAndTraceless,
  K18_DEAD_STATUSES,
  type CreateBatchResult,
} from "./batch.service";
import {
  Prisma,
  PrintedDocType,
  RollEntrySource,
  RollOperationType,
  RollStatus,
  RollForm,
  StationKind,
  StationType,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
  ScanType,
} from "@prisma/client";
import {
  printedDocumentService,
  registerPrintedDocBuilder,
  type BuiltDocContent,
  type PrintedDocDb,
} from "./printed-document.service";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { renderFasonCekiHtml } from "./document-render/fason-ceki.html";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { resolveDispatchCancelBlockReason } from "./helpers/subcontractor-cancel.helper";
import { renderFasonDirectShipHtml } from "./document-render/fason-direct-ship.html";
import { renderFasonReceiptHtml, type FasonReceiptDoc } from "./document-render/fason-receipt.html";
import { buildPagination, buildTurkishSearch } from "../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import {
  recomputeStepStatus,
  ensureWorkOrderInProgress,
  // WO kapanışı YALNIZ bu helper'la yapılır — terminal guard (CANCELLED/SUPERSEDED
  // asla COMPLETED'a dirilmez) orada yaşıyor. Bu dosya eskiden aynı kuralı ÜÇ yerde
  // elle yazıyordu ve üçünde de guard yoktu (denetim 2026-08-09, F-FAS-ESZ-001).
  completeWorkOrderIfStepsDone,
} from "./helpers/roll-step.helper";
import { generateRollBarcode, reserveRollBarcodes } from "./helpers/roll-barcode.helper";
import { recomputeOrderStatusForOrders, touchOrderLinesTx } from "./helpers/order-status.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { assertTargetablePropertyIds } from "./helpers/targetable-property.helper";
import {
  resolveStepWorkInstructions,
  resolveStepDyeColor,
  type FasonWorkInstruction,
} from "./helpers/fason-work-instructions.helper";
// Fasondan doğrudan sevk önizlemesi karşılanma projeksiyonunu shipping'in saf
// FIFO/spec-eşleşmesiyle üretir (tek karşılanma kaynağı; circular yok — shipping
// subcontractor'ı import etmez).
import { allocate, specMatch, type RollSpec, type LineForAlloc } from "./helpers/allocation.helper";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Export: workorder.service per-roll split'te taşınan toplar için yeni FS dispatch
// numarası üretirken yeniden kullanır (aynı sequence kaynağı).
export async function nextPrefixedSequence(
  tx: Prisma.TransactionClient,
  table: "subcontractorDispatch" | "subcontractorReceipt",
  prefix: string,
  date: Date
): Promise<number> {
  const fullPrefix = dailyCodePrefix(prefix, date); // PREFIX + GGAAYY

  // O-21: collation-güvenli — gte (index seek) + startsWith (tam-prefix, collation-
  // bağımsız) ile günün TÜM kayıtlarını çek, sayısal max'ı JS'te reduce et. Eski
  // startsWith-tek + orderBy desc glibc collation sırasına + lex taşmaya güveniyordu
  // (glibc seq-no bug — bkz. order.service.ts kanıtlı desen).
  if (table === "subcontractorDispatch") {
    const rows = await tx.subcontractorDispatch.findMany({
      where: { dispatchNo: { gte: fullPrefix, startsWith: fullPrefix } },
      select: { dispatchNo: true },
    });
    return nextDailySeq(rows.map((r) => r.dispatchNo), fullPrefix);
  }
  const rows = await tx.subcontractorReceipt.findMany({
    where: { receiptNo: { gte: fullPrefix, startsWith: fullPrefix } },
    select: { receiptNo: true },
  });
  return nextDailySeq(rows.map((r) => r.receiptNo), fullPrefix);
}

async function logTravelerScan(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  stationId: string,
  stepId: string,
  scanType: ScanType,
  userId: string | undefined,
  note: string
): Promise<void> {
  const activeCard = await tx.travelerCard.findFirst({
    // Kart iş emri başına — WO'nun aktif kartına yaz.
    where: { workOrderId, status: TravelerCardStatus.ACTIVE },
    select: { id: true },
  });
  if (!activeCard) return;

  await tx.travelerCardScan.create({
    data: {
      cardId: activeCard.id,
      stationId,
      workOrderStepId: stepId,
      scanType,
      scannedById: userId ?? null,
      notes: note,
    },
  });
}

// -----------------------------------------------------------------------------
// Cascade cancel — receipt'ten doğan açık kumaş roll'larının iptal güvenlik kontrolü
// -----------------------------------------------------------------------------

/** Frontend'in iptal preview ekranında listelediği her bornRoll için döner. */
export interface BornRollPreviewItem {
  id: string;
  /** Operatörün gerçekten okuyabildiği kimlik. UUID basmak teşhis değil gürültü. */
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorName: string | null;
  currentQty: number;
  status: RollStatus;
  /** Boş ise cascade iptal güvenli. Dolu ise her satır operatöre gösterilir. */
  blockingReasons: string[];
  safeToCancel: boolean;
}

type BornRollDownstreamShape = {
  status: RollStatus;
  operations: { id: string }[];
  movements: { exitedAt: Date | null }[];
  children: { id: string }[];
  dispatchItems: { id: string }[];
};

/**
 * Bir bornRoll cascade iptal edilebilir mi? Downstream'i olan (operasyon
 * görmüş, sonraki istasyona geçmiş, Tambur'da bölünmüş, başka fasona
 * gönderilmiş) Roll'lar iptal edilemez — önce manuel temizlik gerekir.
 *
 * SAFE statüler: STOCK, IN_PRODUCTION. Diğerleri (TAMBUR_CONSUMED,
 * WAREHOUSE, SCRAP, A1_STOCK, AT_SUBCONTRACTOR vb.) cascade'i tetiklerse
 * iz tutarsızlığı yaratır.
 */
function computeBornRollBlockingReasons(roll: BornRollDownstreamShape): string[] {
  const reasons: string[] = [];
  if (roll.operations.length > 0) {
    reasons.push("Üzerinde işlem yapılmış");
  }
  if (roll.movements.some((m) => m.exitedAt !== null)) {
    reasons.push("Sonraki istasyona geçmiş");
  }
  if (roll.children.length > 0) {
    reasons.push("Tambur'da bölünmüş");
  }
  if (roll.dispatchItems.length > 0) {
    reasons.push("Başka fason sevkinde");
  }
  const safeStatuses: RollStatus[] = [RollStatus.STOCK, RollStatus.IN_PRODUCTION];
  if (!safeStatuses.includes(roll.status)) {
    reasons.push(`Durum: ${roll.status}`);
  }
  return reasons;
}

/**
 * Bekleyen kabul gruplarını PARTİ (sevk) bazında alt-grupla. Çoklu sevkte
 * (aynı adıma parça parça boyahaneye gönderim) operatör "ikisi birlikte mi
 * geldi, tek parti mi?" teyidini ancak partiler ayrı görünürse yapabilir.
 *
 * Parti kimliği = `Roll.batchId` (→ Batch; kaynak sevk `SubcontractorDispatch.batchId`
 * üzerinden bulunur — eski `batchSplitId` kolonu parti-modeli redesign'ıyla kalktı);
 * sevkte daima set edilir, bkz. dispatch() — bu yüzden AT_SUBCONTRACTOR her top
 * tek bir açık sevke eşlenir). Mobil bu diziyi düz render eder; her partiyi
 * ayrı "Geldi/Gelmedi" teyidiyle kabul eder (parti başına bir SubcontractorReceipt).
 */
function buildPendingParties<
  R extends { batchId: string | null; currentQty: Prisma.Decimal },
  D extends {
    id: string;
    batchId: string;
    dispatchNo: string;
    dispatchedAt: Date;
    plateNumber: string | null;
    driverName: string | null;
    subcontractorId: string;
    subcontractor: { id: string; code: string; name: string } | null;
  },
>(rolls: R[], dispatches: D[]) {
  // Parti (batchId) lane'i → dispatch. K10: bir sevk = bir parti → batchId ile eşle.
  const dispatchById = new Map(dispatches.map((d) => [d.batchId, d] as const));
  const byLane = new Map<string, R[]>();
  for (const r of rolls) {
    const key = r.batchId ?? "__none__";
    const arr = byLane.get(key);
    if (arr) arr.push(r);
    else byLane.set(key, [r]);
  }
  const parties = [...byLane.entries()].map(([key, laneRolls]) => {
    const d = key === "__none__" ? null : dispatchById.get(key) ?? null;
    const totalQty = laneRolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0),
    );
    return {
      dispatchId: d?.id ?? null,
      dispatchNo: d?.dispatchNo ?? null,
      dispatchedAt: d?.dispatchedAt ?? null,
      plateNumber: d?.plateNumber ?? null,
      driverName: d?.driverName ?? null,
      subcontractorId: d?.subcontractorId ?? null,
      subcontractor: d?.subcontractor ?? null,
      rolls: laneRolls,
      rollCount: laneRolls.length,
      totalQty,
    };
  });
  // Sevk tarihine göre artan (parti-1 en üstte); kimliksiz (null) en sona.
  parties.sort((a, b) => {
    const at = a.dispatchedAt ? a.dispatchedAt.getTime() : Infinity;
    const bt = b.dispatchedAt ? b.dispatchedAt.getTime() : Infinity;
    return at - bt;
  });
  return parties;
}

// -----------------------------------------------------------------------------
// "Sevk bekliyor" — fason adımında DURAN ama fasona ÇIKMAMIŞ top
// -----------------------------------------------------------------------------

/**
 * Fason adımında bulunup henüz sevk edilmemiş topun statüleri. "Konumu Düzelt"
 * (manuel taşıma) topu fason adımına koyar ama — TASARIM GEREĞİ —
 * `AT_SUBCONTRACTOR` YAPMAZ: mal fiziksel olarak dışarı çıkmadan "dışarıda"
 * işaretlemek envanteri yalanlar. Çıkış ayrıca **Fason Sevk** ile yapılır.
 *
 * TEK KAYNAK: kart-okutma teşhisi (`NEEDS_DISPATCH`), "Bekleyen" listesi ve grup
 * detayı aynı diziyi okur — elle statü listesi kopyalama.
 */
const AWAITING_DISPATCH_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  RollStatus.STOCK,
];

/**
 * Aynı dizinin ham-SQL karşılığı (enum literal — değerler TS enum üyeleridir,
 * kullanıcı girdisi DEĞİL). Elle `'IN_PRODUCTION','STOCK'` yazmak iki kaynağı
 * sessizce ayrıştırırdı.
 */
const awaitingStatusSql = Prisma.join(
  AWAITING_DISPATCH_STATUSES.map((s) => Prisma.raw(`'${s}'`)),
);

/**
 * Tek çağrıda iptal edilebilecek en fazla fason sevki. Bir iş emrinin açık sevk
 * sayısı parti sayısıyla sınırlıdır (K10: bir sevk = bir parti) — pratikte tek
 * haneli. Sınır sessiz kırpma DEĞİL, aşılırsa 400 döner.
 */
const BULK_DISPATCH_CANCEL_MAX = 50;

// -----------------------------------------------------------------------------
// Mesaj hijyeni — hata metinlerinde ham UUID yerine barkod
// -----------------------------------------------------------------------------

/** Barkodsuz açık kumaş topun hata metnindeki karşılığı. */
const UNBARCODED_ROLL_LABEL = "(barkodsuz açık kumaş)";

/**
 * Verilen top id'leri için "insan okunur etiket" haritası: barkod varsa barkod,
 * yoksa `(barkodsuz açık kumaş)`. Operatöre `9f3c1a7e-…` gibi bir UUID göstermek
 * teşhis değil gürültüdür — tabletteki kimse o id ile topu bulamaz.
 *
 * Yalnız HATA yolunda çağrılır (mutlu yolda ek sorgu yok).
 */
async function resolveRollLabels(
  client: Prisma.TransactionClient | typeof prisma,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await client.roll.findMany({
    where: { id: { in: unique } },
    select: { id: true, barcode: true },
  });
  return new Map(rows.map((r) => [r.id, r.barcode ?? UNBARCODED_ROLL_LABEL] as const));
}

/** Etiket haritasında olmayan id (silinmiş/uydurma) için son çare kısaltma. */
function rollLabel(labels: Map<string, string>, id: string): string {
  return labels.get(id) ?? `${id.slice(0, 8)}…`;
}

// -----------------------------------------------------------------------------
// K14 parti-tutarlılık — TEK KAYNAK (iptal önizlemesi + tx içi guard)
// -----------------------------------------------------------------------------

/** Kabul iptalini engelleyen tek bir parti uyuşmazlığı satırı. */
export interface ReceiptBatchMismatchItem {
  rollId: string;
  /** Barkod; barkodsuz açık kumaşta `(barkodsuz açık kumaş)`. */
  barcode: string;
  dispatchNo: string;
  /** Topun ŞU ANKİ partisi (merge/move sonrası). */
  rollBatchNumber: string | null;
  /** Sevk kaydının bağlı olduğu parti. */
  dispatchBatchNumber: string | null;
}

/**
 * K14 parti-tutarlılık kontrolü. Kabul iptali orijinalleri yeniden
 * AT_SUBCONTRACTOR yapar ve kaynak sevk(ler) yeniden OUTSTANDING olur; K14
 * dönmüş partiyi K8 araçlarına (merge/move) açtığından top bu arada BAŞKA
 * partiye taşınmış olabilir. O halde "AT_SUB topun batchId'si = açık sevkin
 * batchId'si" değişmezi (firma çözümü, mobil kabul gruplaması, undoTransfer
 * bunu okur) kırılır.
 *
 * ⚠️ Bu fonksiyon HEM `getCancelPreview` HEM `cancelReceipt`'in tx-içi guard'ı
 * tarafından çağrılır — sorgu ikiye kopyalanırsa drift olur ve operatör
 * `allSafe: true` görüp 409 yer. Tek kaynak burasıdır.
 *
 * ⚠️ SIRALI await — `tx.*` üzerinde `Promise.all` YASAK (pg adapter tek
 * connection'ı seri çalıştırır).
 */
async function computeReceiptBatchMismatches(
  client: Prisma.TransactionClient | typeof prisma,
  rollIds: string[],
  stepId: string,
): Promise<ReceiptBatchMismatchItem[]> {
  if (rollIds.length === 0) return [];
  const rollBatchRows = await client.roll.findMany({
    where: { id: { in: rollIds } },
    select: {
      id: true,
      barcode: true,
      batchId: true,
      batch: { select: { batchNumber: true } },
    },
  });
  const srcDispatchItems = await client.subcontractorDispatchItem.findMany({
    where: {
      rollId: { in: rollIds },
      dispatch: { stepId, cancelledAt: null, directShippedAt: null },
    },
    select: {
      rollId: true,
      dispatch: {
        select: { batchId: true, dispatchNo: true, batch: { select: { batchNumber: true } } },
      },
    },
  });
  const rollBatchById = new Map(rollBatchRows.map((r) => [r.id, r] as const));
  const mismatches: ReceiptBatchMismatchItem[] = [];
  for (const it of srcDispatchItems) {
    const roll = rollBatchById.get(it.rollId);
    if (roll && roll.batchId !== it.dispatch.batchId) {
      mismatches.push({
        rollId: roll.id,
        barcode: roll.barcode ?? UNBARCODED_ROLL_LABEL,
        dispatchNo: it.dispatch.dispatchNo,
        rollBatchNumber: roll.batch?.batchNumber ?? null,
        dispatchBatchNumber: it.dispatch.batch?.batchNumber ?? null,
      });
    }
  }
  return mismatches;
}

/**
 * K14 uyuşmazlık mesajı — önizleme ve guard AYNI metni kullanır.
 * Parti NUMARALARI şart: operatör hangi iki partiyi birleştireceğini bilmeden
 * "birleştirin" demek yönlendirme değil, bilmece olur.
 */
function buildBatchMismatchMessage(items: ReceiptBatchMismatchItem[]): string {
  const detail = items
    .map(
      (m) =>
        `${m.barcode} topu artık ${m.rollBatchNumber ?? "partisiz"} partisinde ` +
        `ama sevk ${m.dispatchNo} → ${m.dispatchBatchNumber ?? "partisiz"} partisine bağlı`,
    )
    .join("; ");
  const pairs = [
    ...new Set(
      items.map((m) => `${m.dispatchBatchNumber ?? "partisiz"} + ${m.rollBatchNumber ?? "partisiz"}`),
    ),
  ].join(", ");
  return (
    `Kabul iptal edilemez — topların parti üyeliği kabulden sonra değişmiş ` +
    `(birleştirme/taşıma): ${detail}. ` +
    `Panelden İş Emri → Partiler → Birleştir ile şu partileri birleştirin: ${pairs}. ` +
    `Sonra iptali tekrar deneyin.`
  );
}

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
  const barcode = await generateRollBarcode(tx, "H");
  const props = await tx.rollProperty.findMany({
    where: { rollId: parent.id },
    // valueId: kısmi-sevk çocuğu ebeveynin değer seçimini de devralır (denetim F6).
    select: { propertyId: true, valueId: true },
  });
  const child = await tx.roll.create({
    data: {
      barcode,
      itemId: parent.itemId,
      colorId: parent.colorId,
      width: parent.width,
      initialQty: shipQty,
      currentQty: shipQty,
      status: RollStatus.AT_SUBCONTRACTOR,
      currentStepId: stepId,
      qualityGrade: parent.qualityGrade,
      qualityGradeId: parent.qualityGradeId,
      parentRollId: parent.id,
      batchId: parent.batchId,
      entrySource: RollEntrySource.TAMBUR_SPLIT,
      createdById: userId ?? null,
      entryStationId: resolveEntryStationId({ stepStationId }),
    },
  });
  if (props.length > 0) {
    await tx.rollProperty.createMany({
      data: props.map((p) => ({
        rollId: child.id,
        propertyId: p.propertyId,
        valueId: p.valueId,
      })),
      skipDuplicates: true,
    });
  }
  const ops = await tx.rollOperation.findMany({
    where: {
      rollId: parent.id,
      operationType: { in: [RollOperationType.KURSUN_APPLIED, RollOperationType.QC2_COMPLETED] },
    },
    select: {
      workOrderStepId: true,
      operationType: true,
      operatorId: true,
      metadata: true,
      machineId: true,
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
  const dec = await tx.roll.updateMany({
    where: { id: parent.id, status: RollStatus.AT_SUBCONTRACTOR, currentQty: { gte: shipQty } },
    data: { currentQty: { decrement: shipQty }, initialQty: { decrement: shipQty } },
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
  const prefix = dailyCodePrefix("DSK");
  const todays = await tx.directShipment.findMany({
    where: { shipmentNo: { gte: prefix, startsWith: prefix } },
    select: { shipmentNo: true },
  });
  const seq = nextDailySeq(todays.map((s) => s.shipmentNo), prefix);
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export class SubcontractorService {
  // ===========================================================================
  // DISPATCH — Fasona sevk
  // ===========================================================================
  async dispatch(
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
       * partide birleştir (diğer kartlar VOID); yoksa 409 MULTI_BATCH döner. 'SEPARATE'
       * bu core metotta işlenmez — bulkDispatchStep parti başına ayrı sevk döngüsü yapar.
       */
      multiBatchStrategy?: "MERGE" | "SEPARATE";
    },
    userId?: string
  ): Promise<ApiResponse<Record<string, unknown>>> {
    if (!data.rollIds || data.rollIds.length === 0) {
      throw AppError.badRequest("En az bir top seçmelisiniz");
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status !== WorkOrderStatus.PLANNED &&
      wo.status !== WorkOrderStatus.IN_PROGRESS
    ) {
      throw AppError.conflict(
        `Bu iş emrinde sevk yapılamaz: ${wo.status}. Sadece PLANNED/IN_PROGRESS.`
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
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
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
    const openDispatches = await prisma.subcontractorDispatch.findMany({
      where: {
        stepId: data.stepId,
        cancelledAt: null,
        directShippedAt: null, // doğrudan-sevk edilmiş sevk "açık" sayılmaz
        items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
      },
      select: {
        id: true,
        dispatchNo: true,
        subcontractorId: true,
        items: { select: { rollId: true } },
      },
    });
    for (const open of openDispatches) {
      const existingRollIds = new Set(open.items.map((i) => i.rollId));
      const sameRolls =
        existingRollIds.size === incomingRollIds.size &&
        [...existingRollIds].every((id) => incomingRollIds.has(id));
      if (sameRolls && open.subcontractorId === data.subcontractorId) {
        return {
          success: true,
          data: open,
          message: `Fason sevki zaten oluşturulmuş (idempotent retry): ${open.dispatchNo}`,
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
            `İş emri ürünü (${expectedLabel}) ile uyuşmayan ${mismatchedRolls.length} top var. "Yine de gönder" seçeneğiyle onaylayın.`,
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
        console.warn(
          `[dispatch] Item mismatch override by user ${userId ?? "?"}: ` +
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
          `${offending.length} top başka iş emrinin partisine kayıtlı — bu sevke alınamaz. ` +
            `Önce topu bu iş emrine bağlayın (yeni parti oluşur) ya da kayıtlı olduğu iş emrinden çıkarın.`,
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

    if (existingBatchIds.length > 1 && data.multiBatchStrategy !== "MERGE") {
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

    // Decimal aritmetik — float drift olmasın; sevk kaydında string'e dökeriz.
    const totalQty = rolls.reduce(
      (s, r) => s.plus(r.currentQty),
      new Prisma.Decimal(0)
    );

    // withBarcodeRetry: dispatchNo (@unique) tx içinde nextPrefixedSequence ile
    // üretiliyor; eşzamanlı iki sevk aynı FS+GGAAYY+NNNN'i hesaplarsa P2002
    // çakışmasında tx baştan denenir → sıra yeniden okunur (kartela/shipping deseni).
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
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
          `Bu iş emrinde sevk yapılamaz: ${woFresh?.status ?? "bulunamadı"}. Sayfayı yenileyin.`
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
      if (!stepFresh) throw AppError.notFound("İş emri adımı bulunamadı");
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
          await deleteIfEmptyAndTraceless(tx, b.id);
        }
      } else if (existingBatchIds.length === 1) {
        dispatchBatchId = existingBatchIds[0];
        // WO-scope tazelemesi (woFresh deseni): cross-WO guard tx DIŞINDA koştu;
        // tx içinde taze doğrula — yabancı parti bu sevkin batchId'si OLAMAZ.
        await assertBatchInWorkOrder(tx, dispatchBatchId, data.workOrderId);
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
      const seq = await nextPrefixedSequence(tx, "subcontractorDispatch", "FS", now);
      const dispatchNo = buildDailyCode("FS", seq, now);

      const dispatch = await tx.subcontractorDispatch.create({
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

      // 2) Açık movement'ı olan topları tek sorguda bul; OLMAYANLAR için yeni
      //    movement aç (açık movement kapanmasın — operatör START atmamış olabilir).
      const openMovements = await tx.rollMovement.findMany({
        where: { rollId: { in: dispatchRollIds }, workOrderStepId: data.stepId, exitedAt: null },
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

      return { dispatch, remainderBatches };
      })
    );

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
        totalQty,
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

  // ===========================================================================
  // BULK DISPATCH — Masaüstü "adımı toplu fasona sevk et" (top okutmadan)
  // ===========================================================================
  //
  // Planlama ekranı için: bir EXTERNAL adımda BEKLEYEN (currentStepId=stepId,
  // status IN_PRODUCTION|STOCK) tüm topları planlanan/seçilen firmaya tek tıkla
  // sevk eder. Top-top okutma yok — saha mobil dispatch()'in masaüstü muadili.
  // GERÇEK dispatch()'e delege eder: irsaliye (PrintedDocument) + AT_SUBCONTRACTOR
  // + atomik claim + audit hepsi oradan gelir (tek kaynak; mobil sevkle aynı yol).
  // (workorder.service quickStart `dispatchFirstStep`'in genelleştirilmiş hali.)
  async bulkDispatchStep(
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
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
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

    // K11 SEPARATE: seçilen toplar 2+ partiye yayılıyorsa PARTİ BAŞINA ayrı sevk
    // (her birinin kendi FS no'su + kartı). Serbest (partisiz) toplar tek grup.
    if (data.multiBatchStrategy === "SEPARATE") {
      const rb = await prisma.roll.findMany({
        where: { id: { in: rolls.map((r) => r.id) } },
        select: { id: true, batchId: true },
      });
      const byBatch = new Map<string, string[]>();
      for (const r of rb) {
        const key = r.batchId ?? "__free__";
        const arr = byBatch.get(key);
        if (arr) arr.push(r.id);
        else byBatch.set(key, [r.id]);
      }
      if (byBatch.size > 1) {
        const dispatches: unknown[] = [];
        for (const [, rollIds] of byBatch) {
          const res = await this.dispatch(
            {
              workOrderId: data.workOrderId,
              stepId: data.stepId,
              subcontractorId,
              rollIds,
              allowRouteSkip: data.allowRouteSkip,
              instruction: data.instruction,
              plateNumber: data.plateNumber,
              driverName: data.driverName,
            },
            userId,
          );
          dispatches.push(res.data);
        }
        return {
          success: true,
          data: { separate: true, dispatchCount: dispatches.length, dispatches },
          message: `${dispatches.length} parti ayrı ayrı sevk edildi.`,
        };
      }
    }

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

  // ===========================================================================
  // TRANSFER TO NEXT FASON — Fasondan fasona doğrudan aktarım (zımpara→boyahane)
  // ===========================================================================
  //
  // Mal fabrikaya UĞRAMADAN bir fasondan diğerine gidiyor. Tek tıkla içerideki
  // "önceki fasondan kabul + sonraki fasona sevk" zincirini yapar:
  //   1) receive(mevcut adım) → orijinaller SUBCONTRACTOR_CONSUMED, born açık-kumaş
  //      toplar bir SONRAKİ adıma IN_PRODUCTION doğar (metraj 1:1 taşınır —
  //      zımparada kesim/çekme yok; kesin ölçüm boyahane DÖNÜŞÜNDE damgalanır).
  //   2) bulkDispatchStep(sonraki adım) → born toplar boyahaneye sevk edilir.
  // Her iki çağrı AYRI tx (dispatchFirstStep kısmi-başarı emsali): 2. patlarsa
  // toplar boyahane adımında bekler, planlamacı "Sevk Et" ile tamamlar.
  async transferToNextFason(
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
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
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
      where: {
        batchId: { in: batchIds },
        stepId: data.stepId,
        cancelledAt: null,
        directShippedAt: null,
        items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
      },
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

  // ===========================================================================
  // ERKEN TASLAK ÇEKİ — sevkten ÖNCE bir sonraki fason adımının çekisini üret
  // ===========================================================================
  //
  // Mal zımpara→boyahane fabrikaya UĞRAMADAN gidebildiği için, planlamacı zımparaya
  // sevk yapar yapmaz boyahane çekisini de basıp mal ile göndermek istiyor. Ama
  // gerçek boyahane sevki (=durum değişikliği: zımpara COMPLETED, born toplar) henüz
  // yapılmamalı. Bu metod HİÇBİR kayıt değiştirmez — sadece bir sonraki fason adımı
  // için, önceki fasonda (AT_SUBCONTRACTOR) bekleyen TOPLARI projekte ederek
  // TASLAK filigranlı çeki HTML'i döndürür (tek-kaynak renderFasonCekiHtml).
  async previewDownstreamFasonCeki(
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
            targetProperties: { select: { propertyId: true, property: { select: { name: true } } } },
            steps: {
              orderBy: { stepSequence: "asc" },
              select: { id: true, stationId: true },
            },
          },
        },
      },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
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
      orderBy: [{ barcode: "asc" }, { createdAt: "asc" }],
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

  // ===========================================================================
  // CANCEL — Sevk iptali (soft cancel)
  // ===========================================================================
  //
  // Kural:
  //   - Dispatch silinmez; cancelledAt/cancelledById/cancelReason set edilir.
  //   - Toplar STOCK'a geri döner ve currentStepId temizlenir (serbest stoğa iner).
  //     Parti üyeliği (batchId) KORUNUR — üyelik attach'te doğar, iptal bozamaz.
  //   - Açık RollMovement varsa "CANCEL:dispatchNo" notuyla kapatılır.
  //   - SUBCONTRACTOR_SENT operation log'u silinir (idempotent).
  //   - Step'te başka aktif sevk/dispatch yoksa PENDING'e döner.
  //   - Mal kabul yapılmış sevk iptal EDİLEMEZ (önce kabul iptal endpoint'i
  //     gerekir — şu an o yok, dolayısıyla blok).
  //   - Refakat kartına CANCEL log'u düşülür.
  //
  async cancel(
    dispatchId: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        items: true,
        step: { select: { id: true, status: true, stationId: true, workOrderId: true } },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");

    const rollIds = dispatch.items.map((i) => i.rollId);

    // Mal kabul edilmiş sevk iptal edilemez (ReceiptItem.sourceDispatchItem
    // üzerinden bağlı). cancelledAt:null filtresi şart — iptal edilmiş receipt
    // ReceiptItem'larını da tutar; o durumda dispatch cancel'ı yanlış
    // engellenirdi ("önce kabulü iptal edin" derken zaten iptal edilmiş).
    const acceptedReceiptItem = await prisma.subcontractorReceiptItem.findFirst({
      where: {
        sourceDispatchItem: { is: { dispatchId } },
        receipt: { cancelledAt: null },
      },
      select: { receipt: { select: { receiptNo: true } } },
    });

    // Defansif state check: dispatch'te listelenen tüm rolls hala
    // AT_SUBCONTRACTOR + bu step'te olmalı. Bir şey "fason sevkten sonraki
    // adıma" geçtiyse (receive sonrası, admin manuel taşıma, scrap vs.)
    // dispatch iptali tutarsız state yaratır — engelle. ReceiptItem kontrolü
    // çoğu durumu yakalar; bu ek kontrol exotic durumlar (manuel müdahale)
    // ve cancelled-receipt-then-re-moved senaryoları için savunma derinliği.
    const movedRolls = await prisma.roll.findMany({
      where: {
        id: { in: rollIds },
        OR: [
          { status: { not: RollStatus.AT_SUBCONTRACTOR } },
          { currentStepId: { not: dispatch.stepId } },
        ],
      },
      select: { id: true, barcode: true, status: true, currentStepId: true },
    });

    // Engel kararı TEK KAYNAKTAN (`resolveDispatchCancelBlockReason`) — iptal
    // önizlemesi (`getCancelImpact.openDispatches[].cancellable`) aynı yüklemi
    // çağırır. Kopyalanırsa ekran "iptal edilebilir" der, uç 409 verir.
    const blockReason = resolveDispatchCancelBlockReason({
      cancelledAt: dispatch.cancelledAt,
      activeReceiptNo: acceptedReceiptItem?.receipt?.receiptNo ?? null,
      movedRollCount: movedRolls.length,
    });
    if (blockReason) {
      throw AppError.conflict(
        blockReason,
        movedRolls.length > 0 && !dispatch.cancelledAt && !acceptedReceiptItem
          ? {
              code: "ROLLS_MOVED_PAST_DISPATCH",
              movedRolls: movedRolls.map((r) => ({
                id: r.id,
                barcode: r.barcode,
                status: r.status,
                currentStepId: r.currentStepId,
              })),
            }
          : undefined,
      );
    }

    await prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — adım/WO yeniden
      // değerlendirmesi (openDispatchCount/remainingAtSub) eşzamanlı dispatch'le serileşsin.
      await touchWorkOrderTx(tx, dispatch.workOrderId);
      // 1) Dispatch'i soft-cancel — ATOMİK CLAIM: yukarıdaki guard'lar tx
      //    DIŞINDA; eşzamanlı çift iptal ikisinde de geçerdi. cancelledAt:null
      //    koşuluyla kaybeden burada 409 alır.
      const cancelClaim = await tx.subcontractorDispatch.updateMany({
        where: { id: dispatchId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmedReason,
        },
      });
      if (cancelClaim.count === 0) {
        throw AppError.conflict("Bu sevk az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }
      // Sevk iptal edildi → kartın parti bloğundaki "Sevk" sütunu boşalır (ya da
      // varsa bir önceki sevke düşer). Basılı kâğıt iptal edilmiş sevki gösteriyor.
      await markTravelerCardDirtyTx(tx, dispatch.workOrderId);

      // 1b) RESMİ BELGE — irsaliye VOIDED'e çekilir (baskıda İPTAL filigranı).
      // Belge silinmez; tarihsel kayıt korunur.
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DISPATCH,
        dispatchId,
        trimmedReason
      );

      // 2) Toplar: STOCK + currentStepId temizle — ATOMİK CLAIM (movedRolls
      //    kontrolü tx dışında; eşzamanlı kabul/başka işlem pencerede araya
      //    girdiyse count uyuşmaz → 409 + rollback). batchId BİLİNÇLİ KORUNUR:
      //    parti üyeliği attach'te doğar, sevk iptali üyeliği bozmaz — iptal
      //    yalnız sevk belgesini geri alır; top aynı iş emrinde yeniden sevk
      //    edilirse aynı partiyle yola çıkar (lot kimliği kalıcı). Korunan
      //    batchId'nin BAŞKA iş emrinin sevkine sızması dispatch() içindeki
      //    cross-WO parti guard'ı (FOREIGN_BATCH → 400) ile engellenir.
      const reverted = await tx.roll.updateMany({
        where: {
          id: { in: rollIds },
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: dispatch.stepId,
        },
        data: { status: RollStatus.STOCK, currentStepId: null },
      });
      if (reverted.count !== rollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle (kabul/taşıma) değişmiş — sevk iptal edilemedi. Listeyi yenileyip tekrar deneyin."
        );
      }

      // 3) Açık RollMovement'ları CANCEL notuyla kapat — tek raw UPDATE (eski kod
      //    movement başına findMany+update = N+1; iptal edilen sevkte yüzlerce roll
      //    olabilir). notes per-row eski değere bağlı olduğundan CASE ile concat:
      //    doluysa "eski | CANCEL:x", boş/null ise "CANCEL:x".
      const cancelTag = `CANCEL:${dispatch.dispatchNo}`;
      await tx.$executeRaw`
        UPDATE "roll_movements"
        -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
        -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
        SET "exitedAt" = (now() AT TIME ZONE 'UTC'),
            "notes" = CASE
              WHEN "notes" IS NULL OR "notes" = '' THEN ${cancelTag}
              ELSE "notes" || ' | ' || ${cancelTag}
            END
        WHERE "rollId" = ANY(${rollIds}::uuid[])
          AND "workOrderStepId" = ${dispatch.stepId}::uuid
          AND "exitedAt" IS NULL
      `;

      // 4) SUBCONTRACTOR_SENT operation log'larını sil (idempotent — yoksa atla)
      await tx.rollOperation.deleteMany({
        where: {
          rollId: { in: rollIds },
          workOrderStepId: dispatch.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_SENT,
        },
      });

      // 5) Adım durumunu yeniden değerlendir. Eski sayaç KABUL EDİLMİŞ sevkleri
      //    de "aktif" sayıyordu ve COMPLETED'a dönüş yolu yoktu: D1 tamamen
      //    kabul edildi + ek parti D2 iptal edildi → adım boş ama sonsuza dek
      //    ACTIVE kalıyor, WO hiç tamamlanamıyordu (tek kurtarma yeni fiziksel
      //    sevk ya da DB müdahalesiydi).
      if (dispatch.step.status === StepStatus.ACTIVE) {
        // Hâlâ AÇIK sevk (kabul görmemiş kalemi olan) veya bekleyen top var mı?
        const openDispatchCount = await tx.subcontractorDispatch.count({
          where: {
            stepId: dispatch.stepId,
            cancelledAt: null,
            id: { not: dispatchId },
            items: {
              some: { receiptItems: { none: { receipt: { cancelledAt: null } } } },
            },
          },
        });
        const remainingAtSub = await tx.roll.count({
          where: { currentStepId: dispatch.stepId, status: RollStatus.AT_SUBCONTRACTOR },
        });
        if (openDispatchCount === 0 && remainingAtSub === 0) {
          const receiptCount = await tx.subcontractorReceipt.count({
            where: { stepId: dispatch.stepId, cancelledAt: null },
          });
          if (receiptCount > 0) {
            // Geçmişte kabul var → adım tamamlanmış sayılır (COMPLETED'a geri dön).
            await tx.workOrderStep.update({
              where: { id: dispatch.stepId },
              data: { status: StepStatus.COMPLETED, completedAt: new Date() },
            });
            // Bu adım WO'nun son eksik adımıysa WO'yu tamamla (receive'daki
            // kontrolün aynası — iptal sonrası WO IN_PROGRESS'te takılmasın).
            // Adım sayımı + kart geçişi helper'ın İÇİNDE; burada elle tekrarlama.
            await completeWorkOrderIfStepsDone(tx, dispatch.workOrderId);
          } else {
            // Hiç kabul yok → sevk öncesi duruma (PENDING) dön.
            await tx.workOrderStep.update({
              where: { id: dispatch.stepId },
              data: { status: StepStatus.PENDING, startedAt: null },
            });
          }
        }
      }

      // 6) Refakat kartı INFO scan (sevk iptal bildirimi)
      await logTravelerScan(
        tx,
        dispatch.workOrderId,
        dispatch.step.stationId,
        dispatch.stepId,
        ScanType.INFO,
        userId,
        `Fason sevk iptal: ${dispatch.dispatchNo} — ${trimmedReason}`
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: dispatchId,
      newData: {
        cancelled: true,
        cancelReason: trimmedReason,
        rolledBackRollCount: rollIds.length,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Sevk iptal edildi: ${dispatch.dispatchNo}`,
    };
  }

  /**
   * ÇOK SEVKİ tek çağrıda iptal eder → toplar depoya döner.
   *
   * Neden var: bir iş emrinin fason çıkışı K10 gereği parti başına AYRI sevktir
   * (`SubcontractorDispatch.batchId` NOT NULL). Malı içeri almak isteyen kişi
   * bugün parti parti gezip her sevki tek tek iptal ediyor — iş emrini iptal
   * etmenin ön koşulu tam olarak bu. Uç, o gezinmeyi tek onaya indirir.
   *
   * ⚠️ SONUÇ PARÇALIDIR ve bu BİLİNÇLİDİR (`kursun-bypass.cancelBulk` sözleşmesi):
   * her sevk KENDİ tx'inde iptal edilir. Tek tx yanlış olurdu — (a) `cancel()`
   * her sevkte WO satırını kilitler, onlarca sevki tek tx'te tutmak deadlock
   * riskidir; (b) hepsi-ya-hiç semantiği burada zararlıdır: aralarından biri bu
   * arada mal kabul görmüşse diğerlerinin iptalini geri almak kullanıcının
   * niyetine aykırıdır. Karşılığında atlanan her sevk SOMUT sebebiyle döner —
   * "5 sevk iptal edildi" deyip 2'sinin neden atlandığını yutmak en kötüsüdür.
   */
  async cancelBulk(
    input: { dispatchIds: string[]; reason: string },
    userId?: string
  ): Promise<
    ApiResponse<{
      cancelled: number;
      cancelledNos: string[];
      failed: Array<{ dispatchId: string; dispatchNo: string | null; message: string }>;
    }>
  > {
    const trimmedReason = input.reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }
    // Tekrarlı id gönderimi ikinci turda "zaten iptal edilmiş" hatası üretirdi —
    // kullanıcının görmediği bir çift tıklama, uydurma bir başarısızlık satırına
    // dönüşmemeli.
    const ids = [...new Set(input.dispatchIds)];
    if (ids.length === 0) {
      throw AppError.badRequest("İptal edilecek sevk seçilmedi");
    }
    if (ids.length > BULK_DISPATCH_CANCEL_MAX) {
      throw AppError.badRequest(
        `Tek seferde en fazla ${BULK_DISPATCH_CANCEL_MAX} sevk iptal edilebilir`
      );
    }

    // Sevk numaraları başarısızlık satırında da görünsün — kullanıcı "hangisi
    // atlandı" sorusunu id ile değil belge numarasıyla sorar. Bilinmeyen id de
    // `failed` satırıdır: tek yanlış id yüzünden 404 ile tüm çağrıyı düşürmek,
    // geri kalan 20 sevki sebepsiz yere fasonda bırakırdı.
    const known = await prisma.subcontractorDispatch.findMany({
      where: { id: { in: ids } },
      select: { id: true, dispatchNo: true, workOrderId: true, dispatchedAt: true },
    });
    const byId = new Map(known.map((d) => [d.id, d]));

    // ⚠️ DETERMİNİSTİK SIRA — deadlock önlemi, süs değil. Bir toplu seçim çoğunlukla
    // AYNI iş emrinin partilerini taşır ve `cancel()` her satırda `touchWorkOrderTx`
    // ile o WO satırını kilitler. İki kullanıcı çakışan kümeleri farklı sırayla
    // gönderirse kilitler ters sırada alınır ve deadlock doğar. Global sıra bunu
    // yapısal olarak imkânsız kılar.
    const ordered = [...ids].sort((a, b) => {
      const da = byId.get(a);
      const db = byId.get(b);
      if (!da || !db) return da ? -1 : db ? 1 : a.localeCompare(b);
      if (da.workOrderId !== db.workOrderId) return da.workOrderId.localeCompare(db.workOrderId);
      const ta = da.dispatchedAt?.getTime() ?? 0;
      const tb = db.dispatchedAt?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      return a.localeCompare(b);
    });

    const cancelledNos: string[] = [];
    const failed: Array<{ dispatchId: string; dispatchNo: string | null; message: string }> = [];

    // SIRALI koşar (Promise.all DEĞİL): her `cancel()` aynı WO satırını kilitler;
    // paralel çalıştırmak kilitleri rastgele sırada alıp deadlock üretirdi.
    for (const dispatchId of ordered) {
      const dispatchNo = byId.get(dispatchId)?.dispatchNo ?? null;
      try {
        await this.cancel(dispatchId, trimmedReason, userId);
        cancelledNos.push(dispatchNo ?? dispatchId);
      } catch (e) {
        // ⚠️ YALNIZ iş kuralı hatası `failed` satırına dönüşür. DB kesintisi ya da
        // programlama hatası (`AppError` olmayan her şey) YUTULMAZ — yoksa gerçek
        // bir arıza "2 sevk atlandı" diye rapor edilir ve kimse bakmaz.
        if (!(e instanceof AppError)) throw e;
        failed.push({ dispatchId, dispatchNo, message: e.message });
      }
    }

    return {
      success: true,
      data: { cancelled: cancelledNos.length, cancelledNos, failed },
      message:
        failed.length === 0
          ? `${cancelledNos.length} sevk iptal edildi, toplar depoya döndü`
          : `${cancelledNos.length} sevk iptal edildi, ${failed.length} tanesi atlandı`,
    };
  }

  // ===========================================================================
  // RECEIVE — Fason mal kabul (etiket basmaz, ölçüm yapmaz)
  // ===========================================================================
  //
  // YENİ MODEL (boyahane gibi açık kumaş döndüren fason):
  //   - Orijinal Roll'lar TERMINAL'e çekilir (status=SUBCONTRACTOR_CONSUMED).
  //     Fiziksel olarak top kaybolmuştur (boyahane top açıp birleştirmiş).
  //   - Yeni Roll BURADA AÇILMAZ. Yeni "açık kumaş" Roll'ları Kurşun/KK2 istasyonu
  //     operatörü tarafından (`POST /api/rolls/open-fabric`) açılır; receipt'ten
  //     colorId + propertyIds inherit edilir.
  //   - Receipt'e appliedColorId + appliedPropertyIds yazılır (renk veren
  //     kategoriden gelmişse WO.targetColor/Properties'tan otomatik kopyalanır;
  //     UI override gönderebilir).
  //   - Bu step'in tüm outstanding'i consumed olunca step COMPLETED.
  //   - Sonraki step PENDING kalır (Roll yok); operatör Kurşun/KK2'de ilk
  //     açık kumaş Roll'u oluşturduğunda step ACTIVE olur.
  //
  async receive(
    data: {
      workOrderId: string;
      stepId: string;
      subcontractorId: string;
      manifestNo?: string | null; // Opsiyonel — fason her zaman irsaliye vermeyebilir
      returns: Array<{
        rollId: string;         // Orijinal fasona gönderilmiş top
        notes?: string | null;  // Bu topa dair kabul notu (opsiyonel)
      }>;
      notes?: string;
      /// Override — fason kategorisi appliesColor=true ise WO.targetColorId
      /// otomatik kullanılır; UI farklı renk seçtiyse buradan gönderilir.
      appliedColorId?: string | null;
      /// Override — fason kategorisi appliesProperty=true ise WO.targetProperties
      /// otomatik kullanılır; UI farklı liste verirse buradan gönderilir (replace).
      appliedPropertyIds?: string[];
      /// Bu kabulde ÖLÇÜLEN en (cm) — doğan TÜM parçalara uygulanır ve makbuza yazılır.
      /// Renkten farkı: renk yalnız "renk veren" kategoride sorulur, en HER fason
      /// dönüşünde sorulur (topun enini ilk kez burada öğreniyoruz — ham girişte en
      /// tasarım gereği yazılmıyor). Zorunluluk ARAYÜZDE; burada opsiyonel kalması
      /// zorunludur, yoksa alanı göndermeyen eski APK'ların her kabulü 400 alır.
      appliedWidth?: number | null;
      /// Fasondan gelen açık kumaş parçaları — verilirse Receipt anında yeni
      /// "open-fabric" Roll'lar otomatik doğar ve rotadaki bir sonraki adıma
      /// bağlanır. Verilmezse mevcut akış: Kurşun/KK2 operatörü
      /// `POST /api/rolls/open-fabric` ile manuel açar.
      newRolls?: Array<{
        qty: number;
        weightKg?: number | null;
        notes?: string | null;
      }>;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!data.returns || data.returns.length === 0) {
      throw AppError.badRequest("En az bir dönüş kaydı girin");
    }

    // IDEMPOTENCY (offline sync replay): yalnız bu çağrıdaki dönüş kümesiyle
    // BİREBİR AYNI kümeyi kabul etmiş (iptal edilmemiş) bir makbuz varsa cached
    // döndür — sevk tarafındaki sameRolls guard'ıyla (dispatch) gerçekten simetrik.
    //
    // Eski guard KESİŞİME bakıyordu (findFirst, newRollId IN incoming): kısmi
    // örtüşen payload'da ({R1,R2} gelir, R1 önceden kabul edilmiş) makbuz-1 cached
    // dönüyor, R2 SESSİZCE atlanıyordu — operatör başarı toast'ı görür, top
    // AT_SUBCONTRACTOR'da takılı kalırdı. Artık:
    //   TAM küme eşitliği → cached makbuz;
    //   KISMİ örtüşme    → cached DÖNME, akışa devam — tx içindeki atomik claim
    //                      AT_SUBCONTRACTOR olmayan topları net 409'lar;
    //   ayrık küme       → guard tetiklenmez (kısmi/partili dönüş normal kabul).
    //
    // KRİTİK: cancelledAt: null filtresi şart — iptal edilmiş receipt cached
    // dönerse silent failure olur (toast başarılı ama hiçbir şey olmaz).
    const incomingRollIds = data.returns.map((r) => r.rollId);
    const incomingSet = new Set(incomingRollIds);
    const overlappingItems = await prisma.subcontractorReceiptItem.findMany({
      where: {
        newRollId: { in: incomingRollIds },
        receipt: { stepId: data.stepId, cancelledAt: null },
      },
      select: { receiptId: true },
    });
    if (overlappingItems.length > 0) {
      const priorReceipts = await prisma.subcontractorReceipt.findMany({
        where: { id: { in: [...new Set(overlappingItems.map((i) => i.receiptId))] } },
        include: {
          subcontractor: true,
          step: { include: { station: true } },
          items: { include: { newRoll: true } },
        },
      });
      for (const prior of priorReceipts) {
        // Kalemler yalnız returns'ten yazılır (newRolls kalem üretmez, satır 1954)
        // → kalem kümesi = kabul edilen dönüş topları kümesi.
        const priorRollIds = new Set(prior.items.map((i) => i.newRollId));
        const sameRolls =
          priorRollIds.size === incomingSet.size &&
          [...priorRollIds].every((id) => incomingSet.has(id));
        if (sameRolls) {
          return {
            success: true,
            data: prior,
            message: `Mal kabul zaten yapılmış (idempotent retry). Makbuz: ${prior.receiptNo}`,
          };
        }
      }
    }

    const subcontractor = await prisma.subcontractor.findUnique({
      where: { id: data.subcontractorId },
      select: { id: true, isActive: true },
    });
    if (!subcontractor) throw AppError.notFound("Fason firma bulunamadı");
    // Soft-delete guard: pasife alınmış firmadan kabul yapılamaz.
    if (!subcontractor.isActive) throw AppError.badRequest("Fason firma pasif durumda");

    // İrsaliye no opsiyonel — boş geldiyse null sakla.
    const manifestNoTrimmed =
      data.manifestNo && data.manifestNo.trim().length > 0
        ? data.manifestNo.trim()
        : null;

    const wo = await prisma.workOrder.findUnique({
      where: { id: data.workOrderId },
      select: {
        id: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
        targetProperties: { select: { propertyId: true } },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    // Roll.itemId fason dönüşünde DEĞİŞMEZ. Renk ise BU ADIM "renk veren" bir
    // kategoriye (SubcontractorCategory.appliesColor=true) bağlıysa
    // WO.targetColorId'den; özellikler ise "özellik veren" kategoride
    // (SubcontractorCategory.appliesProperty=true) WO.targetProperties'tan
    // otomatik kopyalanır. Aynı adım her ikisini de yapabilir (Boyahane).
    // Planlama tarafı rotada her bayrak için bir adım garanti eder.

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: true,
        requiredCategory: {
          select: {
            id: true,
            name: true,
            appliesColor: true,
            appliesProperty: true,
          },
        },
        workOrder: {
          include: { steps: { orderBy: { stepSequence: "asc" } } },
        },
      },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    // Çapraz kontrol (dispatch ile simetrik): uyuşmaz çiftte makbuz yanlış
    // WO'ya yazılır, born roll'lar yanlış WO'nun targetItem/width'ini alır ve
    // WO-tamamlama bloğu BAŞKA iş emrini COMPLETED'a çekebilirdi (parti-ayırma
    // akışında istemcinin kart-WO/parti-adım eşleştirmesi tam bu hataya açık).
    if (step.workOrderId !== data.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
    }
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest(
        "Mal kabul yalnızca EXTERNAL istasyon adımları için yapılabilir"
      );
    }
    if (step.status !== StepStatus.ACTIVE) {
      throw AppError.badRequest(
        `Adım ACTIVE değil. Önce sevk yapılmış olmalı (mevcut: ${step.status})`
      );
    }

    const appliesColor = !!step.requiredCategory?.appliesColor;
    const appliesProperty = !!step.requiredCategory?.appliesProperty;
    if (appliesColor && !wo.targetColorId && data.appliedColorId === undefined) {
      // Mesaj OPERATÖRE yazılır, geliştiriciye değil: eski hâli "appliedColorId
      // override gönderin" diyordu ve tablette duran kişiye hiçbir şey söylemiyordu
      // — üstelik yapılabilecek tek şeyi (rengi ekrandan seçmek) hiç anmıyordu.
      // Üç dal da somut: ne oldu · ne yapmalı · ekranda o yüzey yoksa neden yok.
      throw AppError.badRequest(
        "Bu iş emrinde hedef renk tanımlı değil — kabulde uygulanan rengi seçmeniz gerekiyor. " +
          "Ekranda renk seçimi görünmüyorsa uygulama sürümü eskidir; yöneticinize bildirin.",
      );
    }

    // appliedColorId / appliedPropertyIds resolution:
    //   - Override gönderildiyse onu kullan (null override de meşru — renk yok)
    //   - Yoksa: appliesColor=true ise WO.targetColorId'den otomatik; değilse null
    //   - Property için ayrı bayrak: appliesProperty=true ise WO.targetProperties;
    //     boş targetProperties bilinçli olabilir → sessizce boş liste
    const resolvedAppliedColorId =
      data.appliedColorId !== undefined
        ? data.appliedColorId
        : appliesColor
          ? wo.targetColorId
          : null;
    // Kabulde ÖLÇÜLEN en — renkten farklı olarak kategoriye BAKMAZ (her fason
    // dönüşünde sorulur). Burada çözülür çünkü iki yerde birden kullanılıyor:
    // makbuz satırı (aşağıda) ve doğan topların width'i (newRolls bloğu).
    // `> 0` süzgeci: 0 "ölçülmedi" demektir, 0 cm'lik kumaş yok.
    const measuredWidth =
      data.appliedWidth != null && data.appliedWidth > 0
        ? new Prisma.Decimal(data.appliedWidth)
        : null;
    // Dedupe ŞART: payload'da tekrar eden property, rollProperty @@unique
    // P2002'sine çarpıp withBarcodeRetry'ı yanlış tetikliyordu (koca kabul
    // tx'i 5 kez boşuna denenip yanıltıcı "Barkod üretimi başarısız" 409'u).
    const resolvedAppliedPropertyIds = [
      ...new Set(
        data.appliedPropertyIds !== undefined
          ? data.appliedPropertyIds
          : appliesProperty
            ? wo.targetProperties.map((p) => p.propertyId)
            : [],
      ),
    ];

    // Override varlık + isActive doğrulaması (soft-delete giriş guard'ı —
    // SEC-2/SEC-3'ün fason kabuldeki kardeşi): pasif renk/özellik born
    // roll'lara sessizce işlenmesin.
    if (data.appliedColorId) {
      const colorRow = await prisma.color.findUnique({
        where: { id: data.appliedColorId },
        select: { isActive: true },
      });
      if (!colorRow || !colorRow.isActive) {
        throw AppError.badRequest("Uygulanan renk bulunamadı veya pasif");
      }
    }
    if (resolvedAppliedPropertyIds.length > 0) {
      // ⚠️ Doğrulama artık KAYNAKTAN BAĞIMSIZ (denetim F3): eski `data.appliedPropertyIds
      // !== undefined` şartı, override GELMEDİĞİNDE WO.targetProperties'ten çözülen
      // listeyi hiç doğrulamıyordu — hedef listesine sızmış bir SEÇİM özelliği
      // (KAT/GRAMAJ) fason dönüşünde doğan HER topa valueId'siz kopyalanırdı.
      const propRows = await prisma.fabricProperty.findMany({
        where: { id: { in: resolvedAppliedPropertyIds }, isActive: true },
        select: { id: true },
      });
      if (propRows.length !== resolvedAppliedPropertyIds.length) {
        throw AppError.badRequest("Uygulanan özelliklerden bazıları bulunamadı veya pasif");
      }
      // SEÇİM tipli özellik fason kabulle UYGULANAMAZ: değeri yoktur, "uygulandı"
      // demek hangi değerin uygulandığını söylemez.
      await assertTargetablePropertyIds(resolvedAppliedPropertyIds, "fason kabulde uygulanan özellik");
    }

    // Bu step'te halen AT_SUBCONTRACTOR olan roller
    const outstandingRolls = await prisma.roll.findMany({
      where: {
        currentStepId: data.stepId,
        status: RollStatus.AT_SUBCONTRACTOR,
      },
      select: {
        id: true,
        barcode: true,
        currentQty: true,
        weightKg: true,
        batchId: true, // F74: kaynak parti (firma çapraz-kontrolü için)
      },
    });
    const outstandingIds = new Set(outstandingRolls.map((r) => r.id));

    // Giriş doğrulaması — hatalı id'ler ÖNCE toplanır, mesaj sonra barkodla
    // kurulur. Ham UUID basmak operatöre hiçbir şey söylemiyordu; barkod
    // sorgusu yalnız hata yolunda koşar (mutlu yolda ek sorgu yok).
    const returnIds = new Set<string>();
    const duplicateIds: string[] = [];
    const notOutstandingIds: string[] = [];
    for (const r of data.returns) {
      if (returnIds.has(r.rollId)) {
        duplicateIds.push(r.rollId);
        continue;
      }
      returnIds.add(r.rollId);
      if (!outstandingIds.has(r.rollId)) {
        notOutstandingIds.push(r.rollId);
      }
    }
    if (duplicateIds.length > 0 || notOutstandingIds.length > 0) {
      const labels = await resolveRollLabels(prisma, [...duplicateIds, ...notOutstandingIds]);
      if (duplicateIds.length > 0) {
        throw AppError.badRequest(
          `Aynı top dönüş listesinde iki kez geçiyor: ` +
            `${duplicateIds.map((id) => rollLabel(labels, id)).join(", ")}`,
        );
      }
      throw AppError.badRequest(
        `Şu toplar bu adımda fasona gönderilmemiş veya zaten dönmüş: ` +
          `${notOutstandingIds.map((id) => rollLabel(labels, id)).join(", ")}`,
      );
    }

    // F74: dönen topların kaynak sevk firması, seçilen firmayla (data.subcontractorId)
    // eşleşmeli — yoksa farklı firmaya ait toplar bu makbuza karışır (firma başına
    // ayrı kabul olmalı). Kaynak dispatch: `Roll.batchId` → `SubcontractorDispatch.batchId`.
    // stepId scope ŞART: parti birden fazla fason adımından geçmişse (ör.
    // Zımpara→Boyahane), önceki adımın kabul edilmiş dispatch'i hâlâ cancelledAt=null
    // kalır; stepId olmadan batchId→firma 1'e-çok olur, Map bayat firmayı tutar ve
    // aynı firmaya doğru yapılan kabulde bile yanlış "farklı firma" hatası üretir.
    const returnedRolls = outstandingRolls.filter((r) => returnIds.has(r.id));
    const srcBatchIds = [
      ...new Set(returnedRolls.map((r) => r.batchId).filter((x): x is string => !!x)),
    ];
    // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
    // merge sonrası survivor'da aynı adımda DÖNMÜŞ + AÇIK sevk yan yana durabilir;
    // outstanding koşulu olmadan Map last-wins belirsizliği dönmüş sevkin (bayat)
    // firmasını tutar ve doğru firmaya yapılan kabul bile yanlış reddedilirdi.
    const srcDispatches =
      srcBatchIds.length > 0
        ? await prisma.subcontractorDispatch.findMany({
            where: {
              batchId: { in: srcBatchIds },
              stepId: data.stepId,
              cancelledAt: null,
              directShippedAt: null,
              items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
            },
            select: { batchId: true, subcontractorId: true },
          })
        : [];
    const firmByBatch = new Map(srcDispatches.map((d) => [d.batchId, d.subcontractorId]));
    for (const r of returnedRolls) {
      const firmId = r.batchId ? firmByBatch.get(r.batchId) : undefined;
      if (!firmId) {
        throw AppError.conflict(
          "Dönen topun kaynak sevki bulunamadı. Listeyi yenileyip tekrar deneyin.",
        );
      }
      if (firmId !== data.subcontractorId) {
        throw AppError.badRequest(
          "Seçilen toplardan biri farklı bir fason firmasına ait — bu makbuza dahil edilemez. Firma başına ayrı kabul yapın.",
        );
      }
    }

    const allSteps = step.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === step.id);
    // F76: ilk NON-SKIPPED sonraki adım (SKIPPED terminal adıma bağlanmayı önle).
    const nextStep =
      currentIndex >= 0
        ? allSteps.slice(currentIndex + 1).find((s) => s.status !== StepStatus.SKIPPED) ?? null
        : null;

    // withBarcodeRetry: receiptNo (@unique) tx içinde nextPrefixedSequence ile
    // üretiliyor; eşzamanlı kabullerde P2002 çakışmasında tx baştan denenir.
    const result = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — stillAtSubcontractor
      // sayımı eşzamanlı dispatch'in commit'li toplarını görsün.
      await touchWorkOrderTx(tx, data.workOrderId);
      const now = new Date();
      const seq = await nextPrefixedSequence(tx, "subcontractorReceipt", "FK", now);
      const receiptNo = buildDailyCode("FK", seq, now);

      const receipt = await tx.subcontractorReceipt.create({
        data: {
          receiptNo,
          manifestNo: manifestNoTrimmed,
          workOrderId: data.workOrderId,
          stepId: data.stepId,
          subcontractorId: data.subcontractorId,
          receivedById: userId ?? null,
          notes: data.notes ?? null,
          appliedColorId: resolvedAppliedColorId,
          appliedWidth: measuredWidth,
        },
      });

      // Receipt'in property listesi — yeni doğacak açık kumaş Roll'ları bunu
      // inherit edecek (Kurşun/KK2'de operatör "yeni kumaş aç" çağrısında).
      if (resolvedAppliedPropertyIds.length > 0) {
        await tx.subcontractorReceiptProperty.createMany({
          data: resolvedAppliedPropertyIds.map((propertyId) => ({
            receiptId: receipt.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // ── Toplu hazırlık ─────────────────────────────────────────────────
      // YENİ MODEL: Roll'lar sonraki step'e taşınmaz. Terminal'e (CONSUMED)
      // çekilir — top fasona gittiyse (boyahane / zımpara / başkası) mutlaka
      // açılır, fiziksel "top" kavramı kaybolur. Yeni Roll'lar Kurşun/KK2'de
      // operatörün open-fabric çağrısıyla doğar.
      const returnRollIds = data.returns.map((r) => r.rollId);

      // 1) Açık movement'leri kapat (qtyOut/weightOut Roll'un sevk anındaki
      //    son ölçümlerinden). Audit izi için kritik — fasona ne gönderdiğimizi
      //    görmek istiyoruz.
      await tx.$executeRaw`
        UPDATE "roll_movements" rm
        SET "qtyOut"   = r."currentQty",
            "weightOut" = r."weightKg",
            -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
            -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
            "exitedAt"  = (now() AT TIME ZONE 'UTC'),
            "notes"     = ${`RETURNED_VIA_RECEIPT:${receiptNo}`}
        FROM "rolls" r
        WHERE rm."rollId" = r."id"
          AND rm."workOrderStepId" = ${data.stepId}::uuid
          AND rm."exitedAt" IS NULL
          AND rm."rollId" = ANY(${returnRollIds}::uuid[])
      `;

      // 2) Orijinal Roll'lar TERMINAL'e: SUBCONTRACTOR_CONSUMED, currentStepId=null.
      //    Top fasona gittiyse mutlaka açıldı — boyahane/zımpara fark etmez,
      //    kimliği kaybeder. currentQty / colorId / RollProperty dokunulmaz —
      //    son hayatın izi audit/raporlamada kalsın.
      //
      // ATOMİK CLAIM (dispatch'teki desenin aynası): idempotency + outstanding
      // guard'ları tx DIŞINDA okunuyor; iki operatör aynı partiyi eşzamanlı
      // kabul ederse ikisi de geçer ve İKİ makbuz + İKİ SET born roll doğardı.
      // withBarcodeRetry bunu kötüleştirir: receiptNo P2002'sinde yalnız tx
      // yeniden denenir, tx-dışı guard'lar koşmaz — kaybeden retry'da temiz
      // commit ederdi. WHERE'e AT_SUBCONTRACTOR koyup count'u doğrula: kaybeden
      // burada 409 alır (AppError.conflict P2002 olmadığından retry'a girmez).
      const consumed = await tx.roll.updateMany({
        where: {
          id: { in: returnRollIds },
          status: RollStatus.AT_SUBCONTRACTOR,
        },
        data: {
          status: RollStatus.SUBCONTRACTOR_CONSUMED,
          currentStepId: null,
        },
      });
      if (consumed.count !== returnRollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle (kabul/iptal) değişmiş. Listeyi yenileyip tekrar deneyin."
        );
      }

      // 3) Receipt item kayıtları — orijinal Roll referansı (audit + UI'da
      //    "bu receipt hangi orijinal toplara karşılık" görünmek için).
      //    sourceDispatchItemId ile kaynak sevk kalemine bağlanır: bu bağ
      //    olmadan open-dispatch guard'ı ve fason raporu sevki sonsuza dek
      //    "açık" görür (dönen/turnaround metrikleri de bozulur). Her dönen
      //    top, bu adımdaki açık (kabul görmemiş) sevk kalemiyle eşleşir.
      const openDispatchItems = await tx.subcontractorDispatchItem.findMany({
        where: {
          rollId: { in: returnRollIds },
          dispatch: { stepId: data.stepId, cancelledAt: null },
          // Sadece İPTAL EDİLMEMİŞ bir receipt item'ı olan kalem "dolu" sayılır.
          // `none: {}` (eski hal) iptal edilmiş receipt item'ı da dolu sayıyordu:
          // top iptal → tekrar fason kabul edilince kalem yeniden bağlanamıyor,
          // sevk sonsuza dek "açık" görünüyordu (dal hep OPEN). İptal edilmişi atla.
          receiptItems: { none: { receipt: { cancelledAt: null } } },
        },
        select: { id: true, rollId: true },
      });
      const dispatchItemByRoll = new Map(
        openDispatchItems.map((di) => [di.rollId, di.id] as const),
      );
      await tx.subcontractorReceiptItem.createMany({
        data: data.returns.map((ret) => ({
          receiptId: receipt.id,
          newRollId: ret.rollId,
          sourceDispatchItemId: dispatchItemByRoll.get(ret.rollId) ?? null,
          notes: ret.notes ?? null,
        })),
      });

      // 4) RollOperation log — orijinal Roll'a son işlem (SUBCONTRACTOR_RETURNED).
      //    Unique key (rollId, stepId, opType) — re-receive sessiz geçer.
      await tx.rollOperation.createMany({
        data: data.returns.map((ret) => ({
          rollId: ret.rollId,
          workOrderStepId: data.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
          operatorId: userId ?? null,
          metadata: {
            receiptNo,
            manifestNo: manifestNoTrimmed,
            returnNote: ret.notes ?? null,
            consumedAtSubcontractor: true,
          } as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });

      // Step COMPLETED (tüm outstanding'ler dönmediyse hala ACTIVE kalmalı)
      const stillAtSubcontractor = await tx.roll.count({
        where: {
          currentStepId: data.stepId,
          status: RollStatus.AT_SUBCONTRACTOR,
        },
      });
      if (stillAtSubcontractor === 0) {
        await tx.workOrderStep.update({
          where: { id: step.id },
          data: { status: StepStatus.COMPLETED, completedAt: new Date() },
        });
      }

      // Son step + hepsi tamamlandıysa WO COMPLETED (adım sayımı + kart geçişi
      // helper'ın içinde; terminal guard da orada).
      if (!nextStep && stillAtSubcontractor === 0) {
        await completeWorkOrderIfStepsDone(tx, data.workOrderId);
      }

      // 5) newRolls açık kumaş Roll'larını burada doğur. Controller seviyesinde
      //    min(1) zorunlu — fason kabul her zaman en az bir açık kumaş parçasıyla
      //    yapılır. Sonraki adım rotadaki bir sonraki adım: fason ise oraya
      //    bağlanır (kullanıcı sonra Dispatch çağırır), değilse Kurşun/KK2 gibi
      //    internal step'e. nextStep yoksa Roll'lar serbest stokta kalır.
      if (data.newRolls && data.newRolls.length > 0) {
        // Kaynak roll'lardan inherit: itemId + width. ItemId: WO.targetItemId önce
        // (rota hedefi belli) — değilse source.
        //
        // WIDTH ÖNCELİĞİ (2026-08-05'te DEĞİŞTİ — sıra load-bearing):
        //   1. data.appliedWidth — kabulü yapan personelin ÖLÇTÜĞÜ değer
        //   2. sourceRoll.width — kaynak topun eni
        //   3. wo.width — iş emri hedef eni
        // Eskiden 1. basamak yoktu ve yorum "kumaş eni boyahanede değişmez" diyordu;
        // bu YANLIŞTI: ram/fikse/sanfor tam da eni değiştiren operasyonlardır. Üstelik
        // pratikte 2. ve 3. basamak da boştu (ham girişte en yazılmıyor → kaynak top
        // ensiz), yani doğan top ensiz doğuyor ve bir daha hiç en kazanmıyordu.
        // Operatörün ölçümü en üstte: gözlem, varsayımı yener.
        const sourceRoll = await tx.roll.findFirst({
          where: { id: { in: returnRollIds } },
          select: { itemId: true, width: true },
        });
        const bornItemId = wo.targetItemId ?? sourceRoll?.itemId ?? null;
        const bornWidth = measuredWidth ?? sourceRoll?.width ?? wo.width ?? null;
        if (!bornItemId) {
          throw AppError.badRequest(
            "Yeni Roll için item belirlenemedi (WO.targetItemId ve kaynak Roll itemId yok)"
          );
        }

        // Phase 4: born roll'lar kaynak partinin (dönen orijinal topların) dal
        // kimliğini kalıtır → dönüş çıktısı tüm rota boyunca aynı lane'de izlenir.
        const sourceLotRolls = await tx.roll.findMany({
          where: { id: { in: data.returns.map((r) => r.rollId) } },
          select: { batchId: true },
        });
        const bornBatchId =
          sourceLotRolls.find((r) => r.batchId)?.batchId ?? null;

        // Pre-validate + explicit UUID üret → top başına create+create (N+1) yerine
        // createMany batch. createMany nested write desteklemediği ve eklenen id'leri
        // sıralı döndürmediği için id'leri burada üretip roll→movement/property eşliyoruz.
        // (Born roll'larda barcode null — açık kumaş, sequence retry gerekmez.)
        const bornRollInputs = data.newRolls.map((nr) => {
          if (!Number.isFinite(nr.qty) || nr.qty <= 0) {
            throw AppError.badRequest("Yeni Roll metrajı pozitif olmalı");
          }
          return { id: uuidv4(), nr };
        });

        // Fason bir SON adımsa (nextStep yok): dönen açık-kumaş toplar FİNAL üründür →
        // WAREHOUSE + "her kumaşa etiket" (barkod tx içinde SIRALI üretilir; sayaç satır-
        // kilidiyle serileşir, Promise.all YASAK) + form ACIK. Ara adımsa: IN_PRODUCTION +
        // barkodsuz (kesin ölçüm/etiket bir sonraki İÇ istasyonun FINISH'inde damgalanır;
        // STOCK yerine IN_PRODUCTION — currentStepId dolu, cutOpenFabric bunu zorunlu kılar).
        const bornStatus = nextStep ? RollStatus.IN_PRODUCTION : RollStatus.WAREHOUSE;
        // (2026-08-10, F-CORE-VER-001) TEK rezervasyon — eskiden döngü her doğan
        // top için ayrı bir sayaç turu atıyordu; sayaç satırının kilidi ilk turdan
        // itibaren zaten tutulduğu için araya giren her tur kilidi o kadar
        // uzatıyordu. Ara adımda (nextStep var) barkod HİÇ üretilmez → sayaca
        // dokunulmaz (`count = 0` sayaç satırına hiç yazmaz).
        const reservedBorn = await reserveRollBarcodes(
          tx,
          "F",
          nextStep ? 0 : bornRollInputs.length,
        );
        const bornBarcodes: (string | null)[] = bornRollInputs.map((_, i) =>
          nextStep ? null : reservedBorn[i]!,
        );

        await tx.roll.createMany({
          data: bornRollInputs.map(({ id, nr }, i) => ({
            id,
            itemId: bornItemId,
            colorId: resolvedAppliedColorId,
            initialQty: nr.qty,
            currentQty: nr.qty,
            weightKg: nr.weightKg ?? null,
            width: bornWidth,
            status: bornStatus,
            // Fason dönüşü = açık kumaş (Tambur'dan geçmedi), kaliteye bakılmadı.
            form: RollForm.ACIK,
            qualityGrade: null,
            qualityGradeId: null,
            entrySource: "SUBCONTRACTOR_RETURN",
            parentReceiptId: receipt.id,
            batchId: bornBatchId,
            // GİRİŞ İSTASYONU — makbuzun ADIMI (fason istasyonu). Top burada
            // doğdu: orijinal rulolar emekliye ayrıldı, bunlar makbuzdan doğdu.
            //
            // ⚠️ `currentStepId` DEĞİL — o bir SONRAKİ adımdır (nextStep) ve
            // topun gideceği yeri söyler, doğduğu yeri değil. Oradan çözmek
            // her fason dönüşü topuna yanlış istasyon yazardı.
            entryStationId: resolveEntryStationId({ stepStationId: step.stationId }),
            // Born açık-kumaş topu bu fason adımında "üretildi" — roll→WO bağı.
            producedInStepId: data.stepId,
            currentStepId: nextStep ? nextStep.id : null,
            createdById: userId ?? null,
            // Son adım: final barkod üretildi; ara adım: null (sonraki istasyon damgalar).
            barcode: bornBarcodes[i],
          })),
        });

        // Receipt-seviyesi özellikler tüm born roll'larda aynı (resolvedAppliedPropertyIds)
        // → roll × property cross product tek createMany ile. skipDuplicates:
        // @@unique(rollId,propertyId) çakışması koca tx'i retry'a sokmasın
        // (receiptProperty createMany'siyle aynı savunma).
        if (resolvedAppliedPropertyIds.length > 0) {
          await tx.rollProperty.createMany({
            data: bornRollInputs.flatMap(({ id }) =>
              resolvedAppliedPropertyIds.map((propertyId) => ({ rollId: id, propertyId }))
            ),
            skipDuplicates: true,
          });
        }

        // Sonraki step varsa açılış RollMovement'leri (per-roll qty/weight in) + status.
        if (nextStep) {
          await tx.rollMovement.createMany({
            data: bornRollInputs.map(({ id, nr }) => ({
              rollId: id,
              workOrderStepId: nextStep.id,
              qtyIn: nr.qty,
              weightIn: nr.weightKg ?? null,
              operatorId: userId ?? null,
              notes: `RECEIPT_OPEN_FABRIC:${receiptNo}`,
            })),
          });
          await recomputeStepStatus(tx, nextStep.id);
        }
      }
      // newRolls boş senaryosu artık geçersiz (controller min(1) ile reddediyor).

      // Refakat kartı ARRIVAL
      await logTravelerScan(
        tx,
        data.workOrderId,
        step.stationId,
        step.id,
        ScanType.ARRIVAL,
        userId,
        manifestNoTrimmed
          ? `Fason kabul: ${receiptNo} (İrsaliye: ${manifestNoTrimmed})`
          : `Fason kabul: ${receiptNo}`
      );

      return tx.subcontractorReceipt.findUnique({
        where: { id: receipt.id },
        include: {
          subcontractor: true,
          step: { include: { station: true } },
          items: { include: { newRoll: true } },
        },
      });
      })
    );

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "SUBCONTRACTOR_RECEIPT",
      recordId: result!.id,
      newData: {
        receiptNo: result!.receiptNo,
        manifestNo: result!.manifestNo,
        workOrderId: data.workOrderId,
        stepId: data.stepId,
        consumedRollCount: data.returns.length,
        appliedColorId: resolvedAppliedColorId,
        appliedWidth: measuredWidth ? Number(measuredWidth) : null,
        appliedPropertyIds: resolvedAppliedPropertyIds,
      },
    });

    return {
      success: true,
      data: result,
      message: `Fason kabul tamamlandı: ${result!.receiptNo} (${data.returns.length} orijinal top consumed). Yeni Roll'lar Kurşun/KK2'de açılacak.`,
    };
  }

  // ===========================================================================
  // LIST & QUERIES
  // ===========================================================================

  async listPendingReturns(params?: {
    workOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    if (params?.workOrderId) {
      // ── Refakat kartı akışı: WO'ya özel (küçük sonuç, rolls dahil) ──
      const woId = params.workOrderId;

      // Parti ayırma soy bağı: bu WO'dan ayrılan WO'ları (splitFromId zinciri)
      // kapsama al. Ayrılan parti fiziksel olarak ESKİ refakat kartını taşır —
      // eski kart okutulunca operatör çıkmaza girmesin, ayrılan partinin yeni
      // WO'daki bekleyen grubu da listede görünsün (grup kendi batchNumber'ını
      // taşır, kabul doğru WO'ya düşer). BFS derinlik ≤3 (ayrılanın ayrılması).
      const woIds = [woId];
      let frontier = [woId];
      for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
        const children = await prisma.workOrder.findMany({
          where: { splitFromId: { in: frontier }, isActive: true },
          select: { id: true },
        });
        frontier = children.map((c) => c.id).filter((id) => !woIds.includes(id));
        woIds.push(...frontier);
      }

      const subStepCount = await prisma.workOrderStep.count({
        where: { workOrderId: { in: woIds }, station: { kind: "SUBCONTRACTOR" } },
      });
      if (subStepCount === 0) {
        throw AppError.notFound("Bu iş emrinde fason adımı tanımlı değil", {
          code: "NO_SUBCONTRACTOR_STEP",
          workOrderId: woId,
        });
      }

      const pendingCount = await prisma.roll.count({
        where: {
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStep: { workOrderId: { in: woIds }, station: { kind: "SUBCONTRACTOR" } },
        },
      });

      if (pendingCount === 0) {
        // ── TEŞHİS SIRASI (jenerik mesaj EN SONA) ────────────────────────────
        // Eski davranış tek bir cümle basıyordu ve o cümle kendini yalanlıyordu:
        // "fason adımında bekleyen rulo yok. Mevcut konum: Boyahane (Fason) (1
        // rulo)". Operatör ne yapacağını hiçbir yerden öğrenemiyordu.

        // (a) MAL İÇERİDE BEKLİYOR — "Konumu Düzelt" topu fason adımına taşır ama
        //     tasarım gereği AT_SUBCONTRACTOR YAPMAZ (mal fiziksel olarak dışarı
        //     çıkmadan "dışarıda" işaretlemek envanteri yalanlar). Çıkış ayrıca
        //     Fason Sevk ile yapılır → doğru yönlendirme: önce sevk, sonra kabul.
        const awaitingRows = await prisma.roll.groupBy({
          by: ["currentStepId"],
          where: {
            status: { in: AWAITING_DISPATCH_STATUSES },
            currentStep: {
              workOrderId: { in: woIds },
              station: { kind: StationKind.SUBCONTRACTOR },
            },
          },
          _count: { _all: true },
        });
        if (awaitingRows.length > 0) {
          const awaitingCountByStep = new Map(
            awaitingRows
              .filter((r): r is typeof r & { currentStepId: string } => !!r.currentStepId)
              .map((r) => [r.currentStepId, r._count._all] as const),
          );
          const awaitingSteps = await prisma.workOrderStep.findMany({
            where: { id: { in: [...awaitingCountByStep.keys()] } },
            select: {
              id: true,
              workOrderId: true,
              stepSequence: true,
              station: { select: { name: true } },
            },
            orderBy: { stepSequence: "asc" },
          });
          const target = awaitingSteps[0];
          if (target) {
            throw AppError.badRequest(
              `Toplar '${target.station.name}' adımında ama henüz fasona SEVK EDİLMEMİŞ ` +
                `(konum düzeltmesi sonrası mal içeride bekliyor). ` +
                `Önce Fason Sevk yapın, sonra kabul edin.`,
              {
                code: "NEEDS_DISPATCH",
                workOrderId: target.workOrderId,
                stepId: target.id,
                stationName: target.station.name,
                rollCount: awaitingCountByStep.get(target.id) ?? 0,
              },
            );
          }
        }

        // (b) YANLIŞ İŞ EMRİNE KABUL — kayıt burada, mal fiziksel olarak hâlâ
        //     fasonda. Doğru araç "Konumu Düzelt" DEĞİL, KABUL İPTALİ: o,
        //     orijinalleri AT_SUBCONTRACTOR'a döndürür ve sevki yeniden açar.
        const openReceipt = await prisma.subcontractorReceipt.findFirst({
          where: {
            workOrderId: { in: woIds },
            cancelledAt: null,
            step: { station: { kind: StationKind.SUBCONTRACTOR } },
          },
          orderBy: { receivedAt: "desc" },
          select: { id: true, receiptNo: true, receivedAt: true },
        });
        if (openReceipt) {
          throw AppError.badRequest(
            `Bu iş emrinde ${openReceipt.receiptNo} makbuzuyla kabul yapılmış. ` +
              `Malı yanlış iş emrine kabul ettiyseniz o makbuzu iptal edin — ` +
              `toplar fasona geri döner.`,
            {
              code: "MAYBE_WRONG_RECEIPT",
              receiptId: openReceipt.id,
              receiptNo: openReceipt.receiptNo,
              receivedAt: openReceipt.receivedAt,
            },
          );
        }

        // (c) Gerçekten başka bir istasyondayız. Jenerik mesaj KALIR ama "mevcut
        //     konum" listesinden FASON adımları ÇIKARILIR — aksi halde cümle
        //     kendini yalanlar (yukarıdaki saha bulgusu).
        const stepsWithRolls = await prisma.workOrderStep.findMany({
          where: {
            workOrderId: { in: woIds },
            currentRolls: { some: {} },
            station: { kind: { not: StationKind.SUBCONTRACTOR } },
          },
          select: {
            id: true,
            station: { select: { name: true } },
            _count: { select: { currentRolls: true } },
          },
          orderBy: { stepSequence: "asc" },
        });
        const currentSteps = stepsWithRolls.map((s) => ({
          stepId: s.id,
          stationName: s.station.name,
          rollCount: s._count.currentRolls,
        }));

        if (currentSteps.length === 0) {
          throw AppError.badRequest(
            "Bu iş emrinin fason adımında bekleyen rulo yok ve şu an aktif başka adım da yok. (Üretim henüz başlamamış veya tamamlanmış.)",
            { code: "WO_NOT_AT_SUBCONTRACTOR", currentSteps },
          );
        }

        const stepNames = currentSteps
          .map((s) => `${s.stationName} (${s.rollCount} rulo)`)
          .join(", ");
        throw AppError.badRequest(
          `Bu iş emrinin fason adımında bekleyen rulo yok. Mevcut konum: ${stepNames}. Tabletinizi yanlış istasyonda okutmuş olabilirsiniz.`,
          { code: "WO_NOT_AT_SUBCONTRACTOR", currentSteps },
        );
      }

      const outstandingRolls = await prisma.roll.findMany({
        where: { status: RollStatus.AT_SUBCONTRACTOR, currentStep: { workOrderId: { in: woIds } } },
        select: {
          id: true, barcode: true, currentQty: true, weightKg: true, width: true,
          qualityGrade: true, status: true, currentStepId: true, batchId: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true } },
        },
      });

      const stepIds = [...new Set(outstandingRolls.map((r) => r.currentStepId).filter(Boolean) as string[])];
      const steps = await prisma.workOrderStep.findMany({
        where: { id: { in: stepIds } },
        select: {
          id: true, stepSequence: true, notes: true,
          station: { select: { id: true, code: true, name: true, type: true } },
          // ŞEKİL EŞİTLİĞİ (2026-08-05): bu liste ucu ile adım-detayı ucu AYNI
          // ekranı besliyor ama farklı alanlar dönüyordu — kabulü refakat kartını
          // okutarak açan operatör `appliesColor`'ı hiç görmüyor, renk seçemiyor ve
          // 400 alıyordu; aynı kabul listeden açılınca çalışıyordu. Üç uç artık
          // aynı şekli döner. Renk EKLENİRKEN ÖZELLİKLER DE EKLENMELİ: yalnız
          // rengi eklemek, istemcinin özellik listesini boş görüp kabulde topların
          // özelliklerini (zımparalı/sanforlu) sıfırlamasına yol açardı.
          workOrder: {
            select: {
              id: true, workOrderNumber: true, status: true,
              width: true,
              targetColor: { select: { id: true, code: true, name: true, hex: true } },
              targetProperties: { select: { property: { select: { id: true, code: true, name: true } } } },
            },
          },
          plannedSubcontractor: { select: { id: true, code: true, name: true } },
          requiredCategory: {
            select: { id: true, code: true, name: true, appliesColor: true, appliesProperty: true },
          },
        },
      });

      const dispatches = await prisma.subcontractorDispatch.findMany({
        // Doğrudan-sevk edilmiş sevk "son açık sevk" gösteriminde yer almaz.
        // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
        // buildPendingParties batchId→dispatch Map'i last-wins — dönmüş sevk açık
        // sevki ezip mobil kabul gruplamasında yanlış firma/sevk gösterirdi.
        where: {
          stepId: { in: stepIds },
          cancelledAt: null,
          directShippedAt: null,
          items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
        },
        select: {
          id: true, batchId: true, dispatchNo: true, dispatchedAt: true, plateNumber: true,
          driverName: true, stepId: true, subcontractorId: true,
          subcontractor: { select: { id: true, code: true, name: true } },
        },
        orderBy: { dispatchedAt: "desc" },
      });

      const byStep = new Map<string, typeof dispatches>();
      for (const d of dispatches) {
        const arr = byStep.get(d.stepId) ?? [];
        arr.push(d);
        byStep.set(d.stepId, arr);
      }

      const groups = steps.map((step) => {
        const stepRolls = outstandingRolls.filter((r) => r.currentStepId === step.id);
        const stepDispatches = byStep.get(step.id) ?? [];
        const lastDispatch = stepDispatches[0] ?? null;
        const totalQty = stepRolls.reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));
        return {
          step: {
            id: step.id, stepSequence: step.stepSequence, station: step.station,
            notes: step.notes, requiredCategory: step.requiredCategory,
            plannedSubcontractor: step.plannedSubcontractor,
          },
          // `targetProperties` DÜZLEŞTİRİLİR (`p.property`) — detay ucu da böyle
          // döner. Pivot satırını ham geçirmek istemciye `{ property: {...} }`
          // kabuğu gönderir ve mobil tarafta sessizce boş liste olarak okunur.
          workOrder: {
            id: step.workOrder.id,
            batchNumber: step.workOrder.workOrderNumber,
            status: step.workOrder.status,
            // Hedef en — tablet kabul ekranı "iş emrinde varsa sorma" için kullanır.
            width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
            targetColor: step.workOrder.targetColor ?? null,
            targetProperties: step.workOrder.targetProperties.map((p) => p.property),
          },
          lastDispatch,
          parties: buildPendingParties(stepRolls, stepDispatches),
          rolls: stepRolls,
          rollCount: stepRolls.length,
          totalQty,
          // Okutulan karttan FARKLI bir WO'ya ait grup = bu karttan ayrılmış
          // parti. Mobil batchNumber'ı zaten gösterir; bayrak ileride rozet için.
          isSplitChild: step.workOrder.id !== woId,
        };
      });

      return { success: true, data: groups };
    }

    // ── Tüm bekleyenler: DB-side aggregate, rolls yok ──
    // 500+ grup için COUNT/SUM + distinct kumaş/renk adları DB'de hesaplanır;
    // tek tek Roll satırları frontend'e taşınmaz. Bu özet alanlar (itemNames,
    // colorNames, cardNumbers) client-side arama içindir — operatör parti no
    // dışında kumaş/renk/refakat kart no ile de filtreleyebilsin. Seçim anında
    // rolls /pending-returns/step/:stepId ile lazy-load.
    //
    // "SEVK BEKLİYOR" satırları (awaiting_*): fason adımında DURAN ama henüz
    // fasona çıkmamış toplar. Manuel taşıma ("Konumu Düzelt") bunları üretir ve
    // eskiden liste yalnız AT_SUBCONTRACTOR aradığı için iş emri **hata bile
    // vermeden kayboluyordu**. Aynı adımda iki kova yan yana durabilir (kısmi
    // sevk) → tek satırda FILTER'lı iki agregat; grup anahtarı yine stepId
    // (frontend key'i bölünmez). Bu satırlar kabul akışına SOKULMAZ — rollCount
    // yalnız AT_SUBCONTRACTOR sayar, rolls lazy-load'u da öyle.
    const rollStats = await prisma.$queryRaw<
      Array<{
        currentStepId: string;
        roll_count: bigint;
        // adapter-pg ile SUM(numeric) → Prisma.Decimal döner (string DEĞİL; ölçüldü).
        // COUNT(*) → bigint, ::float cast'li toplamlar → number.
        total_qty: Prisma.Decimal | null;
        awaiting_count: bigint;
        awaiting_qty: Prisma.Decimal | null;
        item_names: string[] | null;
        color_names: string[] | null;
      }>
    >`
      WITH pending_src AS (
        -- (1) Gerçek kabul kuyruğu: fasondaki toplar. Orijinal sorgunun planı
        --     korunur (status seçici, tek tablo).
        SELECT r."currentStepId" AS step_id, r."currentQty" AS qty,
               r."itemId" AS item_id, r."colorId" AS color_id, TRUE AS at_sub
        FROM rolls r
        WHERE r.status = 'AT_SUBCONTRACTOR' AND r."currentStepId" IS NOT NULL
        UNION ALL
        -- (2) "Sevk bekliyor". AYRI dal olması bilinçli: tek sorguda OR yazmak
        --     birinci dalın (asıl kabul kuyruğu) planını da bozardı. Bu dal
        --     ADIM tarafından yazıldı ki planlayıcının elinde fason istasyon →
        --     adım → @@index([currentStepId, status]) nested loop seçeneği
        --     olsun; küme zaten CANLI envanterle sınırlı (IN_PRODUCTION/STOCK
        --     tarihçeyle büyümez, WAREHOUSE/SHIPPED büyür). Hacim artınca
        --     EXPLAIN ile tekrar bak — plan seçimi satır tahminine bağlıdır.
        SELECT r."currentStepId", r."currentQty", r."itemId", r."colorId", FALSE
        FROM work_order_steps wos
        JOIN stations st ON st.id = wos."stationId" AND st.kind = 'SUBCONTRACTOR'
        JOIN rolls r ON r."currentStepId" = wos.id AND r.status IN (${awaitingStatusSql})
      )
      SELECT
        s.step_id AS "currentStepId",
        COUNT(*) FILTER (WHERE s.at_sub) AS roll_count,
        SUM(s.qty) FILTER (WHERE s.at_sub) AS total_qty,
        COUNT(*) FILTER (WHERE NOT s.at_sub) AS awaiting_count,
        SUM(s.qty) FILTER (WHERE NOT s.at_sub) AS awaiting_qty,
        ARRAY_AGG(DISTINCT i.name) AS item_names,
        ARRAY_AGG(DISTINCT c.name) FILTER (WHERE c.name IS NOT NULL) AS color_names
      FROM pending_src s
      JOIN items i ON i.id = s.item_id
      LEFT JOIN colors c ON c.id = s.color_id
      GROUP BY s.step_id
    `;

    if (rollStats.length === 0) return { success: true, data: [] };

    const statsMap = new Map(rollStats.map((s) => [s.currentStepId, s]));
    const stepIds = rollStats.map((s) => s.currentStepId);

    const steps = await prisma.workOrderStep.findMany({
      where: { id: { in: stepIds } },
      select: {
        id: true, stepSequence: true, notes: true,
        station: { select: { id: true, code: true, name: true, type: true } },
        // Şekil eşitliği — yukarıdaki liste ucuyla aynı gerekçe (adım-detayı ucunun
        // şekli kanoniktir; renk ve özellikler BİRLİKTE taşınır).
        workOrder: {
          select: {
            id: true, workOrderNumber: true, status: true,
            width: true,
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
            targetProperties: { select: { property: { select: { id: true, code: true, name: true } } } },
          },
        },
        plannedSubcontractor: { select: { id: true, code: true, name: true } },
        requiredCategory: {
          select: { id: true, code: true, name: true, appliesColor: true, appliesProperty: true },
        },
      },
    });

    const dispatches = await prisma.subcontractorDispatch.findMany({
      // Doğrudan-sevk edilmiş sevk "son açık sevk" gösteriminde yer almaz.
      // outstanding-scope ŞART (WO'ya-özel kardeş sorguyla aynı — K15 retarget
      // dönmüş sevkleri aynı adıma taşıyabilir): lastDispatch en güncel AÇIK sevk
      // olmalı; dönmüş tarihçe sevki listede yanlış firma/sevk gösterirdi.
      where: {
        stepId: { in: stepIds },
        cancelledAt: null,
        directShippedAt: null,
        items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
      },
      select: {
        id: true, dispatchNo: true, dispatchedAt: true, plateNumber: true,
        driverName: true, stepId: true, subcontractorId: true,
        subcontractor: { select: { id: true, code: true, name: true } },
      },
      orderBy: { dispatchedAt: "desc" },
    });

    const byStep = new Map<string, typeof dispatches>();
    for (const d of dispatches) {
      const arr = byStep.get(d.stepId) ?? [];
      arr.push(d);
      byStep.set(d.stepId, arr);
    }

    // Refakat kart no — arama için (WO başına ACTIVE kartlar). steps'in
    // workOrderId'lerinden tek sorguda toplanır.
    const woIds = [...new Set(steps.map((s) => s.workOrder.id))];
    const cards = await prisma.travelerCard.findMany({
      where: { workOrderId: { in: woIds }, status: TravelerCardStatus.ACTIVE },
      select: { workOrderId: true, cardNumber: true },
    });
    const cardsByWo = new Map<string, string[]>();
    for (const c of cards) {
      const arr = cardsByWo.get(c.workOrderId) ?? [];
      arr.push(c.cardNumber);
      cardsByWo.set(c.workOrderId, arr);
    }

    const groups = steps.map((step) => {
      const stat = statsMap.get(step.id);
      const lastDispatch = byStep.get(step.id)?.[0] ?? null;
      return {
        step: {
          id: step.id, stepSequence: step.stepSequence, station: step.station,
          notes: step.notes, requiredCategory: step.requiredCategory,
          plannedSubcontractor: step.plannedSubcontractor,
        },
        // Düzleştirme detay ucuyla aynı — bkz. yukarıdaki not.
        workOrder: {
          id: step.workOrder.id,
          batchNumber: step.workOrder.workOrderNumber,
          status: step.workOrder.status,
          // Hedef en — tablet kabul ekranı "iş emrinde varsa sorma" için kullanır.
          width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
          targetColor: step.workOrder.targetColor ?? null,
          targetProperties: step.workOrder.targetProperties.map((p) => p.property),
        },
        lastDispatch,
        rollCount: Number(stat?.roll_count ?? 0),
        totalQty: new Prisma.Decimal(stat?.total_qty ?? "0"),
        // "Sevk bekliyor" rozeti — fason adımında duran ama fasona ÇIKMAMIŞ top.
        // Kabul akışına GİRMEZ (rollCount/rolls yalnız AT_SUBCONTRACTOR sayar);
        // amaç iş emrinin listeden sessizce kaybolmaması.
        awaitingDispatch: Number(stat?.awaiting_count ?? 0) > 0,
        awaitingDispatchRollCount: Number(stat?.awaiting_count ?? 0),
        awaitingDispatchQty: new Prisma.Decimal(stat?.awaiting_qty ?? "0"),
        // Arama özetleri (client-side filtre için)
        itemNames: stat?.item_names ?? [],
        colorNames: stat?.color_names ?? [],
        cardNumbers: cardsByWo.get(step.workOrder.id) ?? [],
      };
    });

    return { success: true, data: groups };
  }

  /** GET /api/subcontractor/pending-returns/step/:stepId — seçim anında rolls lazy-load */
  async getPendingReturnGroupDetail(stepId: string): Promise<ApiResponse<unknown>> {
    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      select: {
        id: true, stepSequence: true, notes: true,
        station: { select: { id: true, code: true, name: true, type: true, kind: true } },
        workOrder: {
          select: {
            id: true, workOrderNumber: true, status: true,
            width: true,
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
            targetProperties: { select: { property: { select: { id: true, code: true, name: true } } } },
          },
        },
        plannedSubcontractor: { select: { id: true, code: true, name: true } },
        requiredCategory: {
          select: { id: true, code: true, name: true, appliesColor: true, appliesProperty: true },
        },
      },
    });

    if (!step) throw AppError.notFound("Fason adımı bulunamadı");

    const rolls = await prisma.roll.findMany({
      where: { status: RollStatus.AT_SUBCONTRACTOR, currentStepId: stepId },
      select: {
        id: true, barcode: true, currentQty: true, weightKg: true, width: true,
        qualityGrade: true, status: true, currentStepId: true, batchId: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
      },
    });

    // Bu adımın TÜM sevkleri (parti gruplaması için) — iptal edilmemiş.
    // Eskiden tek `lastDispatch` (findFirst) dönüyordu; çoklu sevkte partiler
    // ayrışamıyordu. lastDispatch geriye-uyumluluk için en güncel sevk olarak korunur.
    // outstanding-scope ŞART (K15 retarget dönmüş sevkleri aynı adıma taşıyabilir):
    // buildPendingParties batchId→dispatch Map'i last-wins — dönmüş sevk açık
    // sevki ezip mobil kabul gruplamasında yanlış firma/sevk gösterirdi.
    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: {
        stepId,
        cancelledAt: null,
        directShippedAt: null,
        items: { some: { receiptItems: { none: { receipt: { cancelledAt: null } } } } },
      },
      select: {
        id: true, batchId: true, dispatchNo: true, dispatchedAt: true, plateNumber: true,
        driverName: true, stepId: true, subcontractorId: true,
        subcontractor: { select: { id: true, code: true, name: true } },
      },
      orderBy: { dispatchedAt: "desc" },
    });
    const lastDispatch = dispatches[0] ?? null;

    // "Sevk bekliyor": fason adımında DURAN ama fasona ÇIKMAMIŞ toplar (manuel
    // taşıma sonrası). Kabul akışına GİRMEZ — `rolls`/`parties`/`rollCount`
    // yalnız AT_SUBCONTRACTOR sayar; bu blok sadece görünürlük içindir.
    const awaiting =
      step.station.kind === StationKind.SUBCONTRACTOR
        ? await prisma.roll.aggregate({
            where: { currentStepId: stepId, status: { in: AWAITING_DISPATCH_STATUSES } },
            _count: { _all: true },
            _sum: { currentQty: true },
          })
        : null;
    const awaitingCount = awaiting?._count._all ?? 0;

    const totalQty = rolls.reduce((s, r) => s.plus(r.currentQty), new Prisma.Decimal(0));

    return {
      success: true,
      data: {
        step: {
          id: step.id, stepSequence: step.stepSequence, station: step.station,
          notes: step.notes, requiredCategory: step.requiredCategory,
          plannedSubcontractor: step.plannedSubcontractor,
        },
        workOrder: {
          id: step.workOrder.id,
          batchNumber: step.workOrder.workOrderNumber,
          status: step.workOrder.status,
          // Hedef en — tablet kabul ekranı "iş emrinde varsa sorma" için kullanır.
          width: step.workOrder.width != null ? Number(step.workOrder.width) : null,
          targetColor: step.workOrder.targetColor ?? null,
          targetProperties: step.workOrder.targetProperties.map((p) => p.property),
        },
        lastDispatch,
        parties: buildPendingParties(rolls, dispatches),
        rolls,
        rollCount: rolls.length,
        totalQty,
        awaitingDispatch: awaitingCount > 0,
        awaitingDispatchRollCount: awaitingCount,
        awaitingDispatchQty: new Prisma.Decimal(awaiting?._sum.currentQty ?? 0),
      },
    };
  }

  async listDispatches(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    /** 'all' (varsayılan) · 'active' = iptal edilmemiş · 'cancelled' = iptal edilmiş. */
    status?: "all" | "active" | "cancelled";
    /** sevk no / fason firma adı / parti kodu (case-insensitive). */
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    // offset (eski FasonSevk modal davranışı + geriye uyum)
    page?: number;
    pageSize?: number;
    // cursor (yeni Fason Sevk Geçmişi sayfası — keyset, derin sayfalama hızlı)
    cursor?: string;
    mode?: string;
    limit?: number;
    withTotal?: boolean;
  }): Promise<{
    success: true;
    data: unknown[];
    pagination: {
      page?: number;
      pageSize?: number;
      total?: number;
      totalPages?: number;
      nextCursor?: string | null;
      hasMore?: boolean;
      limit?: number;
      totalEstimate?: number;
    };
  }> {
    const where: Prisma.SubcontractorDispatchWhereInput = {};
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;

    const status = params?.status ?? "all";
    if (status === "active") where.cancelledAt = null;
    else if (status === "cancelled") where.cancelledAt = { not: null };

    if (params?.dateFrom || params?.dateTo) {
      where.dispatchedAt = {
        ...(params?.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params?.dateTo ? { lte: params.dateTo } : {}),
      };
    }

    const search = params?.search?.trim();
    if (search) {
      // Y-2/Y-3: Türkçe-duyarlı arama (C-locale ILIKE İ/ı katlamaz).
      where.OR = buildTurkishSearch<Prisma.SubcontractorDispatchWhereInput>(search, [
        "dispatchNo",
        "subcontractor.name",
        "workOrder.workOrderNumber",
      ]);
    }

    // Liste için ÇOK HAFIF select — detay endpoint (`getDispatch`) tam veriyi döner.
    // Müşteri/orderLinks gibi N+ join'ler list response'unu şişiriyordu;
    // operatör detaya tıkladığında lazy fetch ile zenginleşir.
    const select = {
      id: true,
      dispatchNo: true,
      dispatchedAt: true,
      totalQty: true,
      plateNumber: true,
      driverName: true,
      notes: true,
      instruction: true,
      stepId: true,
      cancelledAt: true,
      cancelReason: true,
      workOrder: { select: { id: true, workOrderNumber: true } },
      subcontractor: { select: { id: true, name: true } },
      _count: { select: { items: true } },
    } as const;

    // CURSOR mode (Fason Sevk Geçmişi sayfası): keyset by dispatchedAt desc + id desc.
    // count YOK (withTotal ile opt-in) → derin sayfalamada sabit maliyet.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 30), 100);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "dispatchedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.subcontractorDispatch.findMany({
          where: whereClause,
          select,
          orderBy: [{ dispatchedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal
          ? prisma.subcontractorDispatch.count({ where })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "dispatchedAt") : null;
      return {
        success: true,
        data: rows,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET mode (geriye uyum).
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 10));
    // buildPagination MAX_OFFSET=10K aşımında 400 fırlatır (curl saldırı yüzeyi).
    const { skip } = buildPagination(page, pageSize);

    const [dispatches, total] = await Promise.all([
      prisma.subcontractorDispatch.findMany({
        where,
        select,
        orderBy: { dispatchedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.subcontractorDispatch.count({ where }),
    ]);

    return {
      success: true,
      data: dispatches,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  async getDispatch(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        plannedSubcontractor: true,
        // WO + sipariş + müşteri zinciri (detay panelinde "kim için" göstermek için)
        workOrder: {
          include: {
            targetItem: true,
            targetColor: true,
            targetProperties: { include: { property: true } },
            orderLinks: {
              include: {
                orderLine: {
                  include: {
                    item: true,
                    color: true,
                    order: { include: { customer: true } },
                  },
                },
              },
            },
          },
        },
        step: { include: { station: true } },
        items: {
          include: {
            roll: {
              include: {
                item: true,
                color: true,
              },
            },
          },
        },
        dispatchedBy: { select: { id: true, username: true, fullName: true } },
        cancelledBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    return { success: true, data: dispatch };
  }

  async listReceipts(params?: {
    workOrderId?: string;
    subcontractorId?: string;
    page?: number;
    pageSize?: number;
    /** Cursor mode (DEFAULT — Geçmiş Kabuller sonsuz akışı): keyset by receivedAt. */
    mode?: string;
    limit?: number;
    cursor?: string;
    /** İlk sayfada yaklaşık toplam için (cursor mode'da count opt-in). */
    withTotal?: boolean;
    /**
     * İptal edilebilirlik filtresi — mobil "İptal Edilebilirler" vs "Geçmiş
     * Kabuller" sekmelerini ayırır. Mantık: bir receipt iptal edilebilir <=>
     * tüm bornRoll'ları "güvenli durumda" (üzerinde işlem yok, sonraki adıma
     * geçmemiş, bölünmemiş, başka sevkte değil, status STOCK/IN_PRODUCTION).
     *   - 'yes' → tüm bornRoll'ları güvenli
     *   - 'no'  → en az bir bornRoll bloklu (settled)
     *   - undefined → her ikisi (varsayılan, eski davranış)
     * BornRoll'sız receipt'ler her zaman cancellable sayılır (none: vacuously true).
     */
    cancellable?: "yes" | "no";
  }): Promise<{
    success: true;
    data: unknown[];
    pagination:
      | { page: number; pageSize: number; total: number; totalPages: number }
      | { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
  }> {
    // Default: iptal edilmiş receipt'ler listede görünmez — operatörün geçmiş
    // kabuller ekranında kafası karışmasın. Cancel sonrası soft-delete olduğu
    // için kayıt durur ama listelenmez. İleride admin "iptaller dahil" görünümü
    // isterse explicit query param ile açılır.
    const where: Prisma.SubcontractorReceiptWhereInput = { cancelledAt: null };
    if (params?.workOrderId) where.workOrderId = params.workOrderId;
    if (params?.subcontractorId) where.subcontractorId = params.subcontractorId;

    // computeBornRollBlockingReasons ile aynı şartlar — burada Prisma where
    // ile ifade ediliyor ki count + findMany pagination doğru olsun.
    const blockingCondition: Prisma.RollWhereInput = {
      OR: [
        { operations: { some: {} } },
        { movements: { some: { exitedAt: { not: null } } } },
        { children: { some: {} } },
        { dispatchItems: { some: {} } },
        {
          status: {
            notIn: [RollStatus.STOCK, RollStatus.IN_PRODUCTION],
          },
        },
      ],
    };
    if (params?.cancellable === "yes") {
      // Tüm bornRoll'lar güvenli → bloklu bornRoll yok
      where.bornRolls = { none: blockingCondition };
    } else if (params?.cancellable === "no") {
      // En az bir bornRoll bloklu (settled)
      where.bornRolls = { some: blockingCondition };
    }

    // Hafif select — detay `getReceipt` ile lazy gelir (sevk listesindeki desen).
    // Mal kabulde metraj ölçülmez; toplam metraj sevk anındaki `dispatchedQty`
    // toplamından hesaplanır (fason hizmeti — qty değişmez).
    const select = {
      id: true,
      receiptNo: true,
      manifestNo: true,
      receivedAt: true,
      notes: true,
      workOrder: { select: { id: true, workOrderNumber: true } },
      subcontractor: { select: { id: true, name: true, code: true } },
      step: {
        select: {
          id: true,
          stepSequence: true,
          station: { select: { name: true, code: true } },
        },
      },
      receivedBy: { select: { id: true, username: true, fullName: true } },
      _count: { select: { items: true } },
      items: {
        select: {
          sourceDispatchItem: { select: { dispatchedQty: true } },
        },
      },
    } as const;

    // totalQty hesabı (items'tan) — list response'a items taşımadan.
    const enrich = <T extends { items: { sourceDispatchItem: { dispatchedQty: Prisma.Decimal } | null }[] }>(
      rows: T[],
    ) =>
      rows.map(({ items, ...rest }) => ({
        ...rest,
        // Decimal aritmetik — float drift olmasın; serializer number'a çevirir.
        totalQty: items.reduce(
          (sum, it) => sum.plus(it.sourceDispatchItem?.dispatchedQty ?? 0),
          new Prisma.Decimal(0),
        ),
      }));

    // CURSOR mode (DEFAULT — Geçmiş Kabuller sonsuz akışı): keyset by receivedAt
    // desc + id desc. count YOK (withTotal ile opt-in) → derin sayfalamada sabit
    // maliyet + MAX_OFFSET tavanı yok. cancellable filtresi where'de korunur.
    const useCursor = !!params?.cursor || params?.mode === "cursor";
    if (useCursor) {
      const limit = Math.min(Math.max(1, params?.limit ?? 20), 100);
      const cursor = decodeDynamicCursor(params?.cursor);
      const whereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, "receivedAt", "desc")] }
        : where;
      const [items, totalEstimate] = await Promise.all([
        prisma.subcontractorReceipt.findMany({
          where: whereClause,
          select,
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        }),
        params?.withTotal
          ? prisma.subcontractorReceipt.count({ where })
          : Promise.resolve(undefined),
      ]);
      const hasMore = items.length > limit;
      const rows = hasMore ? items.slice(0, limit) : items;
      const last = rows[rows.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "receivedAt") : null;
      return {
        success: true,
        data: enrich(rows),
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET mode (geriye uyum).
    const page = Math.max(1, params?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params?.pageSize ?? 10));
    // buildPagination MAX_OFFSET=10K aşımında 400 fırlatır (curl saldırı yüzeyi).
    const { skip } = buildPagination(page, pageSize);

    const [receipts, total] = await Promise.all([
      prisma.subcontractorReceipt.findMany({
        where,
        select,
        orderBy: { receivedAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.subcontractorReceipt.count({ where }),
    ]);

    return {
      success: true,
      data: enrich(receipts),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
      },
    };
  }

  async getReceipt(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        // ÜRETİM BİLGİSİ (2026-08-09 saha isteği): "mal kabul detayında işlem
        // detayı yok". `workOrder: true` YALNIZ skaler alanları getirir —
        // hedef RENK ADI ve ÖZELLİKLER ilişkidir ve gelmiyordu, yani ekran
        // onları basmak isteseydi boş görürdü.
        // ⚠️ Ders (2026-08-05 "Ekleme Nedeni" vakası): alanı ekrana koymak
        // yetmez, HANGİ YANITTA döndüğünü doğrula.
        workOrder: {
          include: {
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
            targetProperties: {
              select: { property: { select: { id: true, name: true } } },
            },
          },
        },
        step: { include: { station: true } },
        items: {
          include: {
            newRoll: { include: { item: true, color: true } },
            sourceDispatchItem: { include: { roll: true } },
          },
        },
        // Fasondan dönen yeni açık kumaş parçaları (split senaryosu için kritik).
        // UI bunları ayrı section'da listeler; orijinal items ile karıştırılmaz.
        bornRolls: {
          select: {
            id: true,
            initialQty: true,
            currentQty: true,
            weightKg: true,
            width: true,
            // KAT — topun kalıcı özelliği (migration 20260804210000). Seçilmezse
            // ekranda "—" çıkardı ve operatör "kat girilmemiş" sanırdı.
            foldType: true,
            status: true,
            qualityGrade: true,
            item: { select: { code: true, name: true } },
            color: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        receivedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    return { success: true, data: receipt };
  }

  // ===========================================================================
  // DISPATCH BOYA OVERLAY — fason sevk irsaliyesinin CANLI talimat alanları
  // ===========================================================================
  // Donmuş içerik (toplar/totaller/fasoncu/adım) artık PrintedDocument'te. Burada
  // yalnız KASTEN canlı tutulan talimat alanları döner: istenen renk (WO hedef
  // rengi — fason sonrası değişebilir; fasoncuya hangi renge boyanacağını söyler)
  // + fason talimatı (sevk sonrası düzenlenebilir; kabul/iptalde kilitlenir). Talimat
  // boşsa default kaynağı sevk edilen adımın notu (stepNote) → çeki listesine basılır.
  async getDispatchDyeOverlay(id: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      select: {
        cancelledAt: true,
        instruction: true,
        step: { select: { notes: true } },
        workOrder: {
          select: {
            targetColor: { select: { id: true, code: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");

    // P4: Fason talimatı düzenleme kilidi — iptal edilmiş ya da (kabul edilmiş =
    // mal döndü) sevkin talimatı artık değiştirilemez. Frontend editörü buna göre
    // disabled eder; backend updateInstruction de aynı guard'ı uygular.
    const instructionLocked =
      dispatch.cancelledAt != null ||
      (await prisma.subcontractorReceiptItem.count({
        where: {
          sourceDispatchItem: { dispatchId: id },
          receipt: { cancelledAt: null },
        },
      })) > 0;

    return {
      success: true,
      data: {
        requestedColor: dispatch.workOrder.targetColor
          ? {
              id: dispatch.workOrder.targetColor.id,
              code: dispatch.workOrder.targetColor.code,
              name: dispatch.workOrder.targetColor.name,
              hex: dispatch.workOrder.targetColor.hex,
            }
          : null,
        instruction: dispatch.instruction,
        stepNote: dispatch.step.notes,
        instructionLocked,
      },
    };
  }

  // ===========================================================================
  // UPDATE INSTRUCTION — Fason talimatını sevk sonrası düzenle (Electron)
  // ===========================================================================
  // Sevk notu (notes) snapshot'a dondurulduğu için değişmez; fason talimatı ise
  // canlı kolon — planlamacı sevk fişini açıp talimatı sonradan ekleyebilir/
  // düzeltebilir. İptal edilmiş sevkte düzenlemeye izin verilmez.
  async updateInstruction(
    id: string,
    instruction: string | null,
    userId?: string
  ): Promise<ApiResponse<{ id: string; dispatchNo: string; instruction: string | null }>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id },
      select: {
        id: true,
        cancelledAt: true,
        instruction: true,
        // P4: bu sevkin (iptal edilmemiş) bir kabulü var mı? Varsa fason firma
        // malı zaten işledi — talimatı değiştirmek anlamsız/yanıltıcı, kilitle.
        items: {
          select: {
            receiptItems: {
              where: { receipt: { cancelledAt: null } },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    if (dispatch.cancelledAt) {
      throw AppError.conflict("İptal edilmiş sevkin fason talimatı düzenlenemez");
    }
    if (dispatch.items.some((it) => it.receiptItems.length > 0)) {
      throw AppError.conflict(
        "Mal kabul edilmiş — fason talimatı artık düzenlenemez.",
      );
    }

    // Boş/whitespace → null (talimatı temizle).
    const next = instruction && instruction.trim() ? instruction.trim() : null;

    const updated = await prisma.subcontractorDispatch.update({
      where: { id },
      data: { instruction: next },
      select: { id: true, dispatchNo: true, instruction: true },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: id,
      oldData: { instruction: dispatch.instruction },
      newData: { instruction: next },
    });

    return { success: true, data: updated };
  }

  // ===========================================================================
  // CANCEL RECEIPT — Fason kabulün iptali (operatör hatası geri alma)
  // ===========================================================================
  //
  // Kural:
  //   - Receipt soft-cancel edilir (cancelledAt/By/Reason).
  //   - Receipt'teki rulalar AT_SUBCONTRACTOR'a geri çekilir, currentStepId
  //     bu fason adımına döner.
  //   - Receipt seviyesindeki appliedColor / appliedProperty kayıtları silinir
  //     ("renk veren" ya da "özellik veren" kategori bu adımdaydı diye).
  //   - Sonraki adımda her rulo için: kapalı movement, RollOperation veya
  //     yeni dispatch varsa REDDET ("önce o işlemi geri al"). Aksi halde
  //     sonraki adımdaki açık movement silinir.
  //   - Bu adımdaki SUBCONTRACTOR_RETURNED operation log'ları silinir.
  //   - Step status recompute (genelde COMPLETED → ACTIVE'e döner).
  //   - WO COMPLETED iken iptal yasak.
  //
  /**
   * Receipt iptal preview — bornRoll'ları ve her birinin downstream durumunu
   * döner. Frontend bunu kullanarak operatöre "şu açık kumaş roll'ları da
   * iptal edilecek" onayı sunar. allSafe=false ise iptal disabled olmalı.
   */
  async getCancelPreview(receiptId: string): Promise<
    ApiResponse<{
      receiptNo: string;
      receivedAt: Date;
      bornRolls: BornRollPreviewItem[];
      /**
       * K14 parti-tutarlılık engeli — `cancelReceipt`'in tx-içi guard'ıyla AYNI
       * yardımcıdan gelir. Eskiden önizleme bunu hiç sormuyordu: operatör
       * `allSafe: true` görüp butona basıyor, sonra 409 yiyordu.
       */
      batchMismatch: {
        blocked: boolean;
        items: ReceiptBatchMismatchItem[];
        /** Guard'ın basacağı metnin birebir aynısı (null = engel yok). */
        message: string | null;
      };
      allSafe: boolean;
      totalBornRolls: number;
    }>
  > {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        receiptNo: true,
        receivedAt: true,
        cancelledAt: true,
        stepId: true,
        items: { select: { newRollId: true } },
        workOrder: { select: { status: true } },
        bornRolls: {
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            status: true,
            item: { select: { code: true, name: true } },
            color: { select: { name: true } },
            // Downstream check: bu roll üzerinde herhangi bir RollOperation var mı
            operations: { select: { id: true }, take: 1 },
            // Sonraki istasyona çıkmış mı (exitedAt set olmuş RollMovement)
            movements: { select: { exitedAt: true } },
            // Tambur'da bölünmüş mü (çocuk roll türemiş)
            children: { select: { id: true }, take: 1 },
            // Başka fason sevkinde mi
            dispatchItems: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    if (receipt.cancelledAt) {
      throw AppError.conflict("Bu mal kabul zaten iptal edilmiş");
    }
    if (receipt.workOrder.status === "COMPLETED") {
      throw AppError.conflict("Tamamlanmış iş emrinin mal kabulü iptal edilemez");
    }

    const bornRolls: BornRollPreviewItem[] = receipt.bornRolls.map((roll) => {
      const blockingReasons = computeBornRollBlockingReasons(roll);
      return {
        id: roll.id,
        barcode: roll.barcode,
        itemCode: roll.item.code,
        itemName: roll.item.name,
        colorName: roll.color?.name ?? null,
        currentQty: Number(roll.currentQty),
        status: roll.status,
        blockingReasons,
        safeToCancel: blockingReasons.length === 0,
      };
    });

    // K14'ü ÖNE AL — guard ile aynı yardımcı, aynı metin (drift yok).
    const mismatchItems = await computeReceiptBatchMismatches(
      prisma,
      receipt.items.map((it) => it.newRollId),
      receipt.stepId,
    );

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        receivedAt: receipt.receivedAt,
        bornRolls,
        batchMismatch: {
          blocked: mismatchItems.length > 0,
          items: mismatchItems,
          message: mismatchItems.length > 0 ? buildBatchMismatchMessage(mismatchItems) : null,
        },
        // Önizleme bayat olabilir ama "güvenli" demeden önce bilinen TÜM
        // engelleri saymak zorunda.
        allSafe: bornRolls.every((b) => b.safeToCancel) && mismatchItems.length === 0,
        totalBornRolls: bornRolls.length,
      },
    };
  }

  async cancelReceipt(
    receiptId: string,
    reason: string,
    userId?: string,
    cascadeRollIds: string[] = [],
  ): Promise<ApiResponse<{ receiptNo: string; revertedRollCount: number; cascadedRollCount: number }>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("İptal sebebi en az 3 karakter olmalı");
    }

    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: receiptId },
      include: {
        items: { select: { newRollId: true } },
        step: {
          include: {
            workOrder: {
              select: {
                id: true,
                status: true,
                steps: { orderBy: { stepSequence: "asc" }, select: { id: true, stepSequence: true } },
              },
            },
          },
        },
        bornRolls: {
          select: {
            id: true,
            barcode: true,
            currentStepId: true,
            status: true,
            operations: { select: { id: true }, take: 1 },
            movements: { select: { exitedAt: true } },
            children: { select: { id: true }, take: 1 },
            dispatchItems: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    if (receipt.cancelledAt) {
      throw AppError.conflict("Bu mal kabul zaten iptal edilmiş");
    }
    if (receipt.step.workOrder.status === "COMPLETED") {
      throw AppError.conflict("Tamamlanmış iş emrinin mal kabulü iptal edilemez");
    }

    const rollIds = receipt.items.map((it) => it.newRollId);
    if (rollIds.length === 0) {
      throw AppError.badRequest("Bu kabul belgesinde rulo yok");
    }

    // Cascade kontrolü: bornRoll varsa cascadeRollIds tüm bornRoll'ları kapsamalı
    // ve hepsi safety check'ten geçmeli. Aksi halde frontend preview göstermemiş
    // veya bayat veri ile çağırmış demektir → conflict.
    const bornRollIds = receipt.bornRolls.map((b) => b.id);
    if (bornRollIds.length > 0) {
      const cascadeSet = new Set(cascadeRollIds);
      const missing = bornRollIds.filter((id) => !cascadeSet.has(id));
      if (missing.length > 0) {
        throw AppError.conflict(
          `Bu receipt'ten ${bornRollIds.length} açık kumaş Roll'u türemiş. İptal için tümünün onaylanması gerek (${missing.length} eksik). Önce iptal önizlemesini yenileyin.`,
        );
      }
      const extra = cascadeRollIds.filter((id) => !bornRollIds.includes(id));
      if (extra.length > 0) {
        throw AppError.badRequest("Receipt'e ait olmayan Roll id'si gönderildi");
      }
      // Race koruması: preview'den sonra başka oturumda işlem yapılmış olabilir
      for (const roll of receipt.bornRolls) {
        const reasons = computeBornRollBlockingReasons(roll);
        if (reasons.length > 0) {
          throw AppError.conflict(
            `Top işlenmiş, iptal güvenli değil — ${roll.barcode ?? UNBARCODED_ROLL_LABEL}: ${reasons.join(", ")}`,
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Fason completion yarışı (subcon #4): WO satırını kilitle — adım recompute'u
      // (COMPLETED→ACTIVE re-open) eşzamanlı dispatch/receive ile serileşsin.
      await touchWorkOrderTx(tx, receipt.workOrderId);
      // 0) Cascade: bornRoll'ları iptal et (varsa)
      if (bornRollIds.length > 0) {
        // Race koruması (tx İÇİ): yukarıdaki computeBornRollBlockingReasons
        // kontrolü tx DIŞINDA — preview ile tx arasında Kurşun operatörü born
        // roll'a işlem açmış olabilir. Aynı kontrolü taze veriyle tekrarla.
        const freshBornRolls = await tx.roll.findMany({
          where: { id: { in: bornRollIds } },
          select: {
            id: true,
            barcode: true,
            currentStepId: true,
            status: true,
            operations: { select: { id: true }, take: 1 },
            movements: { select: { exitedAt: true } },
            children: { select: { id: true }, take: 1 },
            dispatchItems: { select: { id: true }, take: 1 },
          },
        });
        for (const roll of freshBornRolls) {
          const reasons = computeBornRollBlockingReasons(roll);
          if (reasons.length > 0) {
            throw AppError.conflict(
              `Top bu sırada işlenmiş, iptal güvenli değil — ${roll.barcode ?? UNBARCODED_ROLL_LABEL}: ${reasons.join(", ")}`,
            );
          }
        }
        // RollMovement: bu roll'lara ait, receipt'in açtığı open-fabric movement
        await tx.rollMovement.deleteMany({
          where: {
            rollId: { in: bornRollIds },
            notes: `RECEIPT_OPEN_FABRIC:${receipt.receiptNo}`,
          },
        });
        // RollProperty: receipt'ten inherit edilmişti, sil
        await tx.rollProperty.deleteMany({
          where: { rollId: { in: bornRollIds } },
        });
        // Roll status → CANCELLED, currentStepId temizle
        await tx.roll.updateMany({
          where: { id: { in: bornRollIds } },
          data: {
            status: RollStatus.CANCELLED,
            currentStepId: null,
          },
        });
        // Nextstep recompute (cascade roll'lar oradan çıktı, status değişebilir)
        const nextStepIds = [
          ...new Set(
            receipt.bornRolls
              .map((b) => b.currentStepId)
              .filter((id): id is string => !!id),
          ),
        ];
        for (const stepId of nextStepIds) {
          await recomputeStepStatus(tx, stepId);
        }
      }

      // 1) Receipt'i soft-cancel — ATOMİK CLAIM: cancelledAt kontrolü tx
      //    DIŞINDA; eşzamanlı çift iptal kaybedeni burada 409 alır.
      const receiptClaim = await tx.subcontractorReceipt.updateMany({
        where: { id: receiptId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: trimmedReason,
        },
      });
      if (receiptClaim.count === 0) {
        throw AppError.conflict("Bu mal kabul az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }

      // 2) Bu adım için kapatılmış RollMovement'ları geri aç (RETURNED_VIA_RECEIPT
      //    notuyla kapatılmıştı)
      await tx.rollMovement.updateMany({
        where: {
          workOrderStepId: receipt.stepId,
          rollId: { in: rollIds },
          notes: `RETURNED_VIA_RECEIPT:${receipt.receiptNo}`,
        },
        data: {
          qtyOut: null,
          weightOut: null,
          exitedAt: null,
          notes: `REOPENED_FROM_RECEIPT:${receipt.receiptNo}`,
        },
      });

      // 2.5) K14 parti-tutarlılık guard'ı: kabul iptali orijinalleri yeniden
      //    AT_SUBCONTRACTOR yapar ve kaynak sevk(ler) yeniden OUTSTANDING olur.
      //    K14 dönmüş partiyi K8 araçlarına (merge/move) açtığından, top bu arada
      //    BAŞKA partiye taşınmış olabilir — o halde canlanacak "AT_SUB topun
      //    batchId'si = açık sevkin batchId'si" değişmezi (firma çözümü, mobil
      //    kabul gruplaması, undoTransfer bunu okur) kırılırdı. Uyuşmazlıkta 409:
      //    iptal, üyelik eski partiye dönmeden / K15 belge-taşıma gelmeden yapılamaz.
      //    ⚠️ SIRALI await — `tx.*` üzerinde `Promise.all` YASAK (pg adapter tek
      //    connection'ı seri çalıştırır; pg@9'da hard-error). Paralellik zaten
      //    illüzyondu, davranış değişmiyor.
      //    ⚠️ Guard KALIR (son savunma hattı; önizleme bayat olabilir) ama sorgu
      //    artık `getCancelPreview` ile ORTAK yardımcıdan gelir — iki kopya
      //    kaçınılmaz olarak ayrışır ve operatör "güvenli" görüp 409 yerdi.
      const mismatches = await computeReceiptBatchMismatches(tx, rollIds, receipt.stepId);
      if (mismatches.length > 0) {
        throw AppError.conflict(buildBatchMismatchMessage(mismatches), {
          code: "BATCH_MISMATCH",
          items: mismatches,
        });
      }

      // 3) Orijinal Roll'ları SUBCONTRACTOR_CONSUMED'dan AT_SUBCONTRACTOR'a geri
      //    çek — ATOMİK CLAIM: beklenen statüde olmayan top varsa (eşzamanlı
      //    başka işlem) count uyuşmaz → 409 + rollback.
      const revertedRolls = await tx.roll.updateMany({
        where: { id: { in: rollIds }, status: RollStatus.SUBCONTRACTOR_CONSUMED },
        data: {
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: receipt.stepId,
        },
      });
      if (revertedRolls.count !== rollIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle değişmiş — kabul iptali yapılamadı. Listeyi yenileyip tekrar deneyin."
        );
      }

      // 4) SUBCONTRACTOR_RETURNED operation log'larını sil
      await tx.rollOperation.deleteMany({
        where: {
          rollId: { in: rollIds },
          workOrderStepId: receipt.stepId,
          operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
        },
      });

      // 5) Receipt'in property listesini sil (cancel ⇒ uygulanan kimlik geri alınır)
      await tx.subcontractorReceiptProperty.deleteMany({
        where: { receiptId },
      });

      // 6) Step status recompute (genelde COMPLETED → ACTIVE'e döner)
      await recomputeStepStatus(tx, receipt.stepId);

      // 7) Refakat kartı INFO scan
      await logTravelerScan(
        tx,
        receipt.workOrderId,
        receipt.step.stationId,
        receipt.stepId,
        ScanType.INFO,
        userId,
        `Fason kabul iptal: ${receipt.receiptNo} — ${trimmedReason}`,
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_RECEIPT",
      recordId: receiptId,
      newData: {
        cancelled: true,
        cancelReason: trimmedReason,
        revertedRollCount: rollIds.length,
        cascadedRollCount: bornRollIds.length,
      },
    });

    const cascadeMsg = bornRollIds.length > 0
      ? ` · ${bornRollIds.length} açık kumaş iptal edildi`
      : "";
    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        revertedRollCount: rollIds.length,
        cascadedRollCount: bornRollIds.length,
      },
      message: `Fason kabul iptal edildi: ${receipt.receiptNo} (${rollIds.length} rulo geri çekildi${cascadeMsg})`,
    };
  }

  // ===========================================================================
  // UNDO TRANSFER — "Aktarımı Geri Al" (fason→fason yanlış aktarımı geri sar)
  // ===========================================================================
  //
  // Senaryo: planlamacı malı yanlışlıkla sonraki fasona aktardı (zımpara→boyahane,
  // "Sonraki Fasona Aktar"). Boyahane henüz kabul/işlem YAPMADIYSA tek tıkla geri
  // alınabilmeli — mal kaynak fasona (zımpara) AT_SUBCONTRACTOR olarak geri döner.
  //
  // NEDEN ADANMIŞ TX (cancel()+cancelReceipt() zinciri DEĞİL): aktarım çıktısı born
  // toplar boyahanede AT_SUBCONTRACTOR + kendi boyahane SUBCONTRACTOR_SENT op'una
  // sahip. Naif cancelReceipt() bunu computeBornRollBlockingReasons'da "üzerinde
  // işlem yapılmış" / "başka sevkte" sayıp reddeder; cancel() de born topun
  // movement'ını "geçmiş" damgalar. Bu yüzden undo'ya özel, born topun KENDİ
  // boyahane sevkini meşru kabul eden tek atomik tx yazıyoruz.
  //
  // Şablon: dispatch.cancel() (boyahane sevki) ∪ receipt.cancelReceipt() (kaynak
  // kabul) — ikisi tek tx'te, undo-farkında guard'la.

  /** Salt-okunur önizleme — geri alınacak born toplar + kaynak kabuller + güvenlik. */
  async getUndoTransferPreview(dispatchId: string): Promise<ApiResponse<unknown>> {
    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        subcontractor: { select: { id: true, name: true } },
        step: {
          select: {
            id: true,
            stepSequence: true,
            station: { select: { name: true } },
            workOrder: { select: { id: true, workOrderNumber: true, status: true } },
          },
        },
        items: {
          select: {
            roll: {
              select: {
                id: true,
                barcode: true,
                currentQty: true,
                status: true,
                currentStepId: true,
                parentReceiptId: true,
                operations: { select: { id: true, workOrderStepId: true, operationType: true } },
                movements: { select: { exitedAt: true } },
                children: { select: { id: true }, take: 1 },
                dispatchItems: {
                  where: { dispatch: { is: { cancelledAt: null, id: { not: dispatchId } } } },
                  select: { id: true },
                  take: 1,
                },
                item: { select: { code: true, name: true } },
                color: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");

    const targetStep = dispatch.step; // sonraki fason (ör. boyahane)
    const bornRolls = dispatch.items.map((it) => it.roll);

    const reasons: string[] = [];
    if (dispatch.cancelledAt) reasons.push("Bu sevk zaten iptal edilmiş.");
    if (dispatch.directShippedAt) reasons.push("Bu sevk fasondan sevk edilmiş — geri alınamaz.");

    // Aktarım çıktısı mı? Tüm sevk topları born (parentReceiptId dolu) olmalı.
    const isTransferOutput =
      bornRolls.length > 0 && bornRolls.every((r) => r.parentReceiptId != null);
    if (!isTransferOutput) {
      reasons.push(
        "Bu sevk bir fason→fason aktarım çıktısı değil (doğrudan stok sevki). Bunun yerine 'Sevki İptal Et' kullanın.",
      );
    }

    // Born topların downstream güvenliği: TEK meşru op = bu adımdaki kendi
    // SUBCONTRACTOR_SENT'i; başka her şey "işlenmiş" demektir.
    if (isTransferOutput) {
      for (const r of bornRolls) {
        const tag = r.barcode ?? r.id.slice(0, 8) + "…";
        if (r.status !== RollStatus.AT_SUBCONTRACTOR || r.currentStepId !== targetStep.id) {
          reasons.push(`Top ${tag} artık ${targetStep.station.name}'de beklemiyor (durum: ${r.status}).`);
          continue;
        }
        const extraOps = r.operations.filter(
          (o) =>
            !(o.workOrderStepId === targetStep.id &&
              o.operationType === RollOperationType.SUBCONTRACTOR_SENT),
        );
        if (extraOps.length > 0) reasons.push(`Top ${tag} üzerinde işlem yapılmış.`);
        if (r.movements.some((m) => m.exitedAt !== null)) reasons.push(`Top ${tag} sonraki istasyona geçmiş.`);
        if (r.children.length > 0) reasons.push(`Top ${tag} Tambur'da bölünmüş.`);
        if (r.dispatchItems.length > 0) reasons.push(`Top ${tag} başka bir sevkte.`);
      }
    }

    // Kaynak kabul(ler) = born topların distinct parentReceiptId'si (paralel
    // partilerde farklı firmalardan birden çok olabilir).
    const sourceReceiptIds = [
      ...new Set(bornRolls.map((r) => r.parentReceiptId).filter((x): x is string => !!x)),
    ];
    const sourceReceipts = sourceReceiptIds.length
      ? await prisma.subcontractorReceipt.findMany({
          where: { id: { in: sourceReceiptIds } },
          select: {
            id: true,
            receiptNo: true,
            cancelledAt: true,
            step: { select: { id: true, stepSequence: true, station: { select: { name: true } } } },
            items: {
              select: {
                newRoll: {
                  select: {
                    id: true,
                    barcode: true,
                    currentQty: true,
                    status: true,
                    item: { select: { code: true, name: true } },
                  },
                },
              },
            },
          },
        })
      : [];
    for (const sr of sourceReceipts) {
      if (sr.cancelledAt) reasons.push(`Kaynak kabul ${sr.receiptNo} zaten iptal edilmiş.`);
    }

    // SPLIT GUARD: undo, kaynak kabul(ler)i ATOMİK iptal eder (kabulün TÜM consumed
    // orijinallerini topluca canlandırır). Bu yalnız kabulün doğan TÜM topları bu
    // sevkte ise doğru. Born toplar birden çok sevke dağılmışsa (tek receipt → >1
    // dispatch) veya kısmen ileri taşınmışsa, bu sevki geri almak orijinalleri
    // canlandırırken DİĞER sevkteki kardeş born topları öksüz bırakır + malzemeyi
    // çift sayar → reddet.
    if (isTransferOutput && sourceReceiptIds.length) {
      const bornIdSet = bornRolls.map((r) => r.id);
      const strayBorn = await prisma.roll.count({
        where: {
          parentReceiptId: { in: sourceReceiptIds },
          status: { not: RollStatus.CANCELLED },
          id: { notIn: bornIdSet },
        },
      });
      if (strayBorn > 0) {
        reasons.push(
          "Kaynak kabulden doğan toplar birden çok sevke dağılmış (veya kısmen işlenmiş) — bu aktarım tek başına geri alınamaz; önce diğer sevk(ler)i geri alın.",
        );
      }
    }

    const sourceStationName = sourceReceipts[0]?.step?.station?.name ?? null;

    return {
      success: true,
      data: {
        dispatchId,
        dispatchNo: dispatch.dispatchNo,
        safe: reasons.length === 0,
        blockingReasons: reasons,
        subcontractorName: dispatch.subcontractor.name,
        workOrder: targetStep.workOrder,
        targetStationName: targetStep.station.name,
        sourceStationName,
        bornRolls: bornRolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: Number(r.currentQty),
          status: r.status,
          itemCode: r.item?.code ?? "",
          itemName: r.item?.name ?? "",
          colorName: r.color?.name ?? null,
        })),
        sourceReceipts: sourceReceipts.map((sr) => ({
          id: sr.id,
          receiptNo: sr.receiptNo,
          stationName: sr.step?.station?.name ?? null,
          originalRolls: sr.items.map((it) => ({
            id: it.newRoll.id,
            barcode: it.newRoll.barcode,
            currentQty: Number(it.newRoll.currentQty),
            status: it.newRoll.status,
            itemCode: it.newRoll.item?.code ?? "",
            itemName: it.newRoll.item?.name ?? "",
          })),
        })),
      },
    };
  }

  /**
   * "Aktarımı Geri Al" — adanmış atomik tx: boyahane sevkini iptal et + born
   * topları CANCELLED'a çek + kaynak kabul(ler)i iptal et → orijinaller
   * AT_SUBCONTRACTOR olarak kaynak fasona (batchId korunur) geri döner.
   */
  async undoTransfer(
    dispatchId: string,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ id: string; dispatchNo: string }>> {
    const trimmedReason = reason?.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      throw AppError.badRequest("Geri alma sebebi en az 3 karakter olmalı");
    }

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: dispatchId },
      include: {
        step: { select: { id: true, stationId: true, workOrderId: true } },
        items: {
          select: { roll: { select: { id: true, parentReceiptId: true } } },
        },
      },
    });
    if (!dispatch) throw AppError.notFound("Sevk belgesi bulunamadı");
    if (dispatch.cancelledAt) throw AppError.conflict("Bu sevk zaten iptal edilmiş");
    if (dispatch.directShippedAt) {
      throw AppError.conflict("Fasondan sevk edilmiş sevk geri alınamaz");
    }

    const targetStep = dispatch.step; // boyahane
    const bornRolls = dispatch.items.map((it) => it.roll);
    const bornRollIds = bornRolls.map((r) => r.id);
    if (bornRollIds.length === 0) throw AppError.badRequest("Bu sevkte top yok");

    if (!bornRolls.every((r) => r.parentReceiptId != null)) {
      throw AppError.badRequest(
        "Bu sevk bir fason→fason aktarım çıktısı değil. Bunun yerine 'Sevki İptal Et' kullanın.",
      );
    }
    const sourceReceiptIds = [
      ...new Set(bornRolls.map((r) => r.parentReceiptId).filter((x): x is string => !!x)),
    ];
    const workOrderId = targetStep.workOrderId;

    await prisma.$transaction(async (tx) => {
      // WO satırını kilitle — adım recompute'u eşzamanlı dispatch/receive ile serileşsin.
      await touchWorkOrderTx(tx, workOrderId);

      // 1) Born topların TAZE güvenlik kontrolü (downstream yok + hâlâ boyahanede +
      //    bu sevkin lane'inde). Preview ile tx arasında boyahane operatörü kabul/
      //    işlem yapmış olabilir.
      const freshBorn = await tx.roll.findMany({
        where: { id: { in: bornRollIds } },
        select: {
          id: true,
          status: true,
          currentStepId: true,
          batchId: true,
          operations: { select: { id: true, workOrderStepId: true, operationType: true } },
          movements: { select: { exitedAt: true } },
          children: { select: { id: true }, take: 1 },
          dispatchItems: {
            where: { dispatch: { is: { cancelledAt: null, id: { not: dispatchId } } } },
            select: { id: true },
            take: 1,
          },
        },
      });
      for (const r of freshBorn) {
        if (
          r.status !== RollStatus.AT_SUBCONTRACTOR ||
          r.currentStepId !== targetStep.id ||
          r.batchId !== dispatch.batchId
        ) {
          throw AppError.conflict(
            `Top ${r.id.slice(0, 8)}… artık aktarım geri almaya uygun değil (durum değişmiş). Listeyi yenileyin.`,
          );
        }
        const extraOps = r.operations.filter(
          (o) =>
            !(o.workOrderStepId === targetStep.id &&
              o.operationType === RollOperationType.SUBCONTRACTOR_SENT),
        );
        if (
          extraOps.length > 0 ||
          r.movements.some((m) => m.exitedAt !== null) ||
          r.children.length > 0 ||
          r.dispatchItems.length > 0
        ) {
          throw AppError.conflict(
            `Top ${r.id.slice(0, 8)}… bu sırada işlenmiş — aktarım geri alınamaz.`,
          );
        }
      }

      // SPLIT GUARD (tx-içi taze): kaynak kabul(ler) ATOMİK geri alınır (TÜM consumed
      // orijinaller canlanır), bu yüzden kabulün doğan TÜM topları bu sevkte olmalı.
      // Born toplar birden çok sevke dağılmışsa (tek receipt → >1 dispatch) veya kısmen
      // ileri taşınmışsa, orijinalleri topluca canlandırmak diğer sevkteki kardeş born
      // topları öksüz bırakır + malzemeyi çift sayar. bornRollIds bu noktada hâlâ
      // AT_SUBCONTRACTOR (henüz CANCELLED değil) → notIn + status!=CANCELLED canlı strayı yakalar.
      const strayBorn = await tx.roll.count({
        where: {
          parentReceiptId: { in: sourceReceiptIds },
          status: { not: RollStatus.CANCELLED },
          id: { notIn: bornRollIds },
        },
      });
      if (strayBorn > 0) {
        throw AppError.conflict(
          "Bu sevkin kaynak kabulünden doğan toplar birden çok sevke dağılmış (veya kısmen işlenmiş) — aktarım tek başına geri alınamaz. Önce diğer sevk(ler)i geri alın veya manuel düzeltin.",
        );
      }

      // 2) Boyahane sevkini geri al (soft-cancel + belge void)
      const cancelClaim = await tx.subcontractorDispatch.updateMany({
        where: { id: dispatchId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          cancelReason: `AKTARIM GERİ ALMA: ${trimmedReason}`,
        },
      });
      if (cancelClaim.count === 0) {
        throw AppError.conflict("Bu sevk az önce başka bir kullanıcı tarafından iptal edilmiş.");
      }
      // Aktarım geri alma da bir sevk iptalidir → kart "Sevk" sütunu bayat.
      await markTravelerCardDirtyTx(tx, workOrderId);
      await printedDocumentService.voidForSource(
        tx,
        PrintedDocType.SUBCONTRACTOR_DISPATCH,
        dispatchId,
        trimmedReason,
      );

      // Born topların boyahane izini sil (op + movement + inherit property), sonra
      // CANCELLED'a çek (atomik claim).
      await tx.rollOperation.deleteMany({
        where: {
          rollId: { in: bornRollIds },
          workOrderStepId: targetStep.id,
          operationType: RollOperationType.SUBCONTRACTOR_SENT,
        },
      });
      await tx.rollMovement.deleteMany({
        where: { rollId: { in: bornRollIds }, workOrderStepId: targetStep.id },
      });
      await tx.rollProperty.deleteMany({ where: { rollId: { in: bornRollIds } } });
      const cancelledBorn = await tx.roll.updateMany({
        where: {
          id: { in: bornRollIds },
          status: RollStatus.AT_SUBCONTRACTOR,
          currentStepId: targetStep.id,
          batchId: dispatch.batchId,
        },
        data: { status: RollStatus.CANCELLED, currentStepId: null },
      });
      if (cancelledBorn.count !== bornRollIds.length) {
        throw AppError.conflict(
          "Born toplardan biri bu sırada değişmiş — aktarım geri alınamadı. Listeyi yenileyin.",
        );
      }

      // 3) Kaynak kabul(ler)i geri al — orijinaller AT_SUBCONTRACTOR'a, kaynak
      //    fason adımına döner (batchId DOKUNULMAZ → zımpara lane'i kendiliğinden
      //    geri gelir; receive consume'da değişmemişti).
      const sourceStepIds = new Set<string>();
      for (const receiptId of sourceReceiptIds) {
        const receipt = await tx.subcontractorReceipt.findUnique({
          where: { id: receiptId },
          select: {
            id: true,
            receiptNo: true,
            stepId: true,
            cancelledAt: true,
            step: { select: { stationId: true } },
            items: { select: { newRollId: true } },
          },
        });
        if (!receipt) throw AppError.conflict("Kaynak kabul belgesi bulunamadı.");
        if (receipt.cancelledAt) {
          throw AppError.conflict(`Kaynak kabul ${receipt.receiptNo} zaten iptal edilmiş.`);
        }
        const origRollIds = receipt.items.map((it) => it.newRollId);
        sourceStepIds.add(receipt.stepId);

        const rClaim = await tx.subcontractorReceipt.updateMany({
          where: { id: receiptId, cancelledAt: null },
          data: {
            cancelledAt: new Date(),
            cancelledById: userId ?? null,
            cancelReason: `AKTARIM GERİ ALMA: ${trimmedReason}`,
          },
        });
        if (rClaim.count === 0) {
          throw AppError.conflict(`Kaynak kabul ${receipt.receiptNo} az önce iptal edilmiş.`);
        }

        // Kapatılmış dönüş movement'larını geri aç (RETURNED_VIA_RECEIPT notuyla).
        await tx.rollMovement.updateMany({
          where: {
            workOrderStepId: receipt.stepId,
            rollId: { in: origRollIds },
            notes: `RETURNED_VIA_RECEIPT:${receipt.receiptNo}`,
          },
          data: {
            qtyOut: null,
            weightOut: null,
            exitedAt: null,
            notes: `REOPENED_FROM_RECEIPT:${receipt.receiptNo}`,
          },
        });

        const revertedOrig = await tx.roll.updateMany({
          where: { id: { in: origRollIds }, status: RollStatus.SUBCONTRACTOR_CONSUMED },
          data: { status: RollStatus.AT_SUBCONTRACTOR, currentStepId: receipt.stepId },
        });
        if (revertedOrig.count !== origRollIds.length) {
          throw AppError.conflict(
            "Kaynak orijinal toplardan biri bu sırada değişmiş — geri alınamadı. Listeyi yenileyin.",
          );
        }

        await tx.rollOperation.deleteMany({
          where: {
            rollId: { in: origRollIds },
            workOrderStepId: receipt.stepId,
            operationType: RollOperationType.SUBCONTRACTOR_RETURNED,
          },
        });
        await tx.subcontractorReceiptProperty.deleteMany({ where: { receiptId } });

        await logTravelerScan(
          tx,
          workOrderId,
          receipt.step.stationId,
          receipt.stepId,
          ScanType.INFO,
          userId,
          `Aktarım geri alma — kaynak kabul iptal: ${receipt.receiptNo}`,
        );
      }

      // 4) Adım statülerini yeniden hesapla: kaynak fason → ACTIVE (orijinaller
      //    geri döndü), boyahane → PENDING (born toplar gitti).
      for (const sId of sourceStepIds) {
        await recomputeStepStatus(tx, sId);
      }
      await recomputeStepStatus(tx, targetStep.id);

      // 5) Refakat kartı INFO (boyahane adımında geri-alma bildirimi)
      await logTravelerScan(
        tx,
        workOrderId,
        targetStep.stationId,
        targetStep.id,
        ScanType.INFO,
        userId,
        `Aktarım geri alındı: ${dispatch.dispatchNo} — ${trimmedReason}`,
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SUBCONTRACTOR_DISPATCH",
      recordId: dispatchId,
      newData: {
        undoTransfer: true,
        dispatchNo: dispatch.dispatchNo,
        cancelledReceiptIds: sourceReceiptIds,
        cancelledBornCount: bornRollIds.length,
        reason: trimmedReason,
      },
    });

    return {
      success: true,
      data: { id: dispatchId, dispatchNo: dispatch.dispatchNo },
      message: `Aktarım geri alındı: ${dispatch.dispatchNo} — mal kaynak fasona geri döndü.`,
    };
  }

  // ===========================================================================
  // RECEIPT PRINT SNAPSHOT
  // ===========================================================================
  async getReceiptPrintSnapshot(id: string): Promise<ApiResponse<unknown>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id },
      include: {
        subcontractor: true,
        workOrder: { select: { id: true, workOrderNumber: true, type: true } },
        step: { include: { station: { select: { name: true, code: true } } } },
        receivedBy: { select: { fullName: true } },
        items: {
          include: {
            newRoll: {
              include: {
                item: { select: { code: true, name: true } },
                color: { select: { code: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!receipt) throw AppError.notFound("Kabul belgesi bulunamadı");

    const rolls = receipt.items.map((item, idx) => ({
      sequence: idx + 1,
      id: item.newRoll.id,
      barcode: item.newRoll.barcode,
      itemCode: item.newRoll.item?.code ?? "",
      itemName: item.newRoll.item?.name ?? "",
      colorCode: item.newRoll.color?.code ?? null,
      colorName: item.newRoll.color?.name ?? null,
      qualityGrade: item.newRoll.qualityGrade,
      notes: item.notes ?? null,
    }));

    return {
      success: true,
      data: {
        receiptNo: receipt.receiptNo,
        manifestNo: receipt.manifestNo,
        receivedAt: receipt.receivedAt.toISOString(),
        notes: receipt.notes,
        receivedBy: receipt.receivedBy?.fullName ?? null,
        workOrder: {
          id: receipt.workOrder.id,
          workOrderNumber: receipt.workOrder.workOrderNumber,
          type: receipt.workOrder.type,
        },
        subcontractor: {
          id: receipt.subcontractor.id,
          name: receipt.subcontractor.name,
          code: receipt.subcontractor.code ?? null,
        },
        step: {
          id: receipt.step.id,
          stepSequence: receipt.step.stepSequence,
          station: {
            name: receipt.step.station.name,
            code: receipt.step.station.code,
          },
        },
        rolls,
        totals: { rollCount: rolls.length },
      },
    };
  }

  // ===========================================================================
  // DIRECT SHIP — Fasondan doğrudan sevk (fason fiilen son durak)
  // ===========================================================================
  //
  // Nadir senaryo: mal fasondan bize dönmeden DOĞRUDAN müşteriye sevk edilir.
  // receive() çağrılmadığından toplar sonsuza dek AT_SUBCONTRACTOR'da, dispatch
  // açık, WO hiç COMPLETED olmazdı. Bu manuel müdahale (ofis/yönetim) sevki
  // "doğrudan sevk edildi" diye kapatır: topları tüketir, fason adımını ve
  // (varsa) sonraki planlı adımları kapatır, WO'yu tamamlar; istenirse hangi
  // siparişe gittiği karşılanmaya işlenir; donmuş resmi belge üretir.
  // Şablon: receive() (tüket + WO complete) + cancel() (guard/claim/scan/doc).
  //
  /** Salt-okunur önizleme — etkilenecek toplar/adımlar + aday sipariş satırları. */
  async previewDirectShip(dispatchId: string): Promise<ApiResponse<unknown>> {
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

    const step = dispatch.step;
    const wo = step.workOrder;

    // Etkilenecek toplar: bu sevkte HÂLÂ fasonda olanlar.
    const affectedRolls = dispatch.items
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
      const src = dispatch.items.find((it) => it.roll.id === r.id)!.roll;
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
              quantity: { gt: prisma.orderLine.fields.shippedQty },
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
            console.error("[previewDirectShip] otherOpenLines sorgusu başarısız:", e);
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

  /** Doğrudan sevki yürüt — atomik: tüket + adım/WO kapat + (ops.) karşılanma + belge. */
  async executeDirectShip(
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

    const dispatchRollIds = dispatch.items.map((i) => i.rollId);
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
      }
    }

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
            `İş emri tamamlanamaz: sevk edilenler dışında ${otherInFlight} top hâlâ üretimde veya fasonda. ` +
              `Tamamlarsan bu toplar sahipsiz kalır — önce onları da sevk/kabul et ya da "iş emrini tamamla"yı kapatıp yalnız sevk et.`,
            { code: "WO_HAS_ROLLS_IN_FLIGHT", inFlightCount: otherInFlight },
          );
        }
      }
      // isFullDispatchShip TAZE (F72): WO satırı kilitli olduğundan bu sayım
      // eşzamanlı değişiklikleri (receive()'in dispatch'ten döndürdüğü toplar)
      // görür. roll-consume'dan (aşağıda) ÖNCE yapıldığından shipRollIds hâlâ
      // AT_SUBCONTRACTOR sayılır; biri eşzamanlı taşınmışsa false + roll-claim 409.
      const dispatchStillAtSub = await tx.roll.count({
        where: { id: { in: dispatchRollIds }, status: RollStatus.AT_SUBCONTRACTOR },
      });
      isFullDispatchShip = dispatchStillAtSub === shipRollIds.length;

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
      if (anySplit) {
        if (completeWorkOrder) {
          throw AppError.badRequest(
            "Kısmi (bölünmüş) sevkte iş emri tamamlanamaz — kalan parça hâlâ fasonda.",
          );
        }
        isFullDispatchShip = false; // bölme → dispatch tam sevk edilmedi
      }
      // 1) Dispatch işareti — yalnız dispatch'in TÜMÜ sevk edildiyse directShippedAt
      //    set edilir (atomik claim). Kısmi sevkte dispatch AÇIK kalır; atomiklik
      //    aşağıdaki roll claim'iyle (status=AT_SUBCONTRACTOR + count) sağlanır.
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

      // 2) Açık RollMovement'leri kapat (DIRECT_SHIP notu).
      const tag = `DIRECT_SHIP:${dispatch.dispatchNo}`;
      await tx.$executeRaw`
        UPDATE "roll_movements" rm
        SET "qtyOut" = r."currentQty",
            "weightOut" = r."weightKg",
            -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
            -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
            "exitedAt" = (now() AT TIME ZONE 'UTC'),
            "notes" = CASE
              WHEN rm."notes" IS NULL OR rm."notes" = '' THEN ${tag}
              ELSE rm."notes" || ' | ' || ${tag}
            END
        FROM "rolls" r
        WHERE rm."rollId" = r."id"
          AND rm."workOrderStepId" = ${dispatch.stepId}::uuid
          AND rm."exitedAt" IS NULL
          AND rm."rollId" = ANY(${effectiveShipRollIds}::uuid[])
      `;

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
            -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
            -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
            SET "exitedAt" = (now() AT TIME ZONE 'UTC'),
                "notes" = CASE WHEN "notes" IS NULL OR "notes" = '' THEN 'FASON_DIRECT_SHIP'
                               ELSE "notes" || ' | FASON_DIRECT_SHIP' END
            WHERE "workOrderStepId" IN (
              SELECT "id" FROM "work_order_steps"
              WHERE "workOrderId" = ${dispatch.workOrderId}::uuid
                AND "stepSequence" > ${dispatch.step.stepSequence}
                AND "status" IN ('PENDING','ACTIVE')
            ) AND "exitedAt" IS NULL
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
          await completeWorkOrderIfStepsDone(tx, dispatch.workOrderId);
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
        await recomputeOrderStatusForOrders(tx, [...orderIds]);
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
}

// =============================================================================
// RESMİ BELGE — Fason Sevk İrsaliyesi snapshot builder'ı (PrintedDocument)
// =============================================================================
// Tek üretici iki yolda: freeze (sevk create tx'i) + reissue (gerekçeli revizyon).
// getCurrent belgesi olmayan eski kayıtta bunu lazy-init olarak da kullanır.
// İstenen renk + fason talimatı KASTEN belgede YOK — canlı overlay alanlarıdır
// (fasoncuya talimat; kabul/iptalde kilitlenir), getDispatchDyeOverlay döner.
/** Çeki listesi `doc` payload'ını yapısal parçalardan kurar — hem gerçek sevk
 *  belgesi (buildFasonDispatchDoc) hem erken TASLAK çeki (previewDownstreamFasonCeki)
 *  aynı şekli üretsin diye tek yer. `sequence` ve `totalWeight` burada hesaplanır. */
function assembleFasonCekiDoc(args: {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  instruction: string | null;
  /** `width` = iş emrinin eni. Çekideki TEK "EN" değerinin kaynağı budur —
   *  topun kendi eni DEĞİL (2026-08-06 kullanıcı kararı: "bir tane en değeri
   *  koy, o da iş emrinden gelsin"). Sebep ölçüldü: sahadaki fason sevklerinin
   *  yedisinde sekizde giden topların `Roll.width`'i NULL (KK1'de en opsiyonel
   *  ve doldurulmuyor), iş emrinin eni ise HER ZAMAN dolu. Belge topun eninden
   *  beslendiği sürece EN kolonu başlığıyla basılıp değeriyle boş kalıyordu. */
  workOrder: {
    id: string;
    workOrderNumber: string;
    parameters: Record<string, unknown> | null;
    type: string;
    width: number | null;
  };
  subcontractor: { id: string; name: string; code: string | null };
  requestedColor: string | null;
  /** WO hedef üretim özellikleri (FabricProperty adları) — boyahaneye "bu özellikleri uygula" der.
   *  ⚠️ 2026-08-15'ten sonra kâğıda basılan liste `commands.works`tir; bu alan
   *  payload'da DURUR (eski donmuş belgelerin şekli değişmesin + izlenebilirlik). */
  targetProperties: string[];
  /** BOYAHANEYE GİDEN İKİ TALİMAT (2026-08-15 saha isteği).
   *  ⚠️ `color` YALNIZ `WorkOrder.targetColor.name`; topların mevcut rengine
   *  DÜŞMEZ — "BOYANACAK RENK" etiketi ham/ekru topa "EKRU'ya boya" diyemesin.
   *  ⚠️ `works` BU ADIMA süzülmüş hedeflerdir (istasyon yeteneğiyle kesişim),
   *  iş emrinin TÜM hedefleri DEĞİL — boyahane çekisinde "KURŞUNLU" yazamaz. */
  commands: { color: string | null; works: FasonWorkInstruction[] };
  /** Sevkin partisi (K10: bir sevk = bir parti). Belge DONARKEN zaten bilinir —
   *  `SubcontractorDispatch.batchId` NOT NULL ve aynı create tx'inde yazılır.
   *  Taslak çekide (previewDownstreamFasonCeki) henüz sevk yoktur → projekte edilen
   *  topların partilerinden çözülür, birden fazlaysa virgüllü liste, hiç yoksa null. */
  batchNumber: string | null;
  step: { id: string; stepSequence: number; station: { name: string; code: string } };
  rolls: Array<{
    id: string;
    barcode: string | null;
    itemCode: string;
    itemName: string;
    colorCode: string | null;
    colorName: string | null;
    dispatchedQty: number;
    dispatchedWeight: number | null;
    qualityGrade: string | null;
    width: number | null;
  }>;
  totalQty: number;
}): Record<string, unknown> {
  const rolls = args.rolls.map((r, idx) => ({ sequence: idx + 1, ...r }));
  const totalWeight = Number(rolls.reduce((s, r) => s.plus(r.dispatchedWeight ?? 0), new Prisma.Decimal(0)));
  return {
    dispatchNo: args.dispatchNo,
    dispatchedAt: args.dispatchedAt,
    driverName: args.driverName,
    plateNumber: args.plateNumber,
    notes: args.notes,
    instruction: args.instruction,
    workOrder: args.workOrder,
    subcontractor: args.subcontractor,
    requestedColor: args.requestedColor,
    targetProperties: args.targetProperties,
    commands: args.commands,
    batchNumber: args.batchNumber,
    step: args.step,
    rolls,
    totals: { rollCount: rolls.length, totalQty: args.totalQty, totalWeight },
  };
}

async function buildFasonDispatchDoc(
  db: PrintedDocDb,
  dispatchId: string
): Promise<BuiltDocContent | null> {
  const dispatch = await db.subcontractorDispatch.findUnique({
    where: { id: dispatchId },
    include: {
      subcontractor: { select: { id: true, name: true, code: true } },
      // K10: bir sevk = bir parti. Parti no belgeye DONAR (batchId NOT NULL, aynı tx).
      batch: { select: { batchNumber: true } },
      workOrder: {
        select: {
          id: true,
          workOrderNumber: true,
          parameters: true,
          type: true,
          // Çekideki tek EN değerinin kaynağı (bkz. assembleFasonCekiDoc notu).
          width: true,
          // İstenen renk = boyamanın hedef rengi. Sevkte toplar HAM (renksiz) gider;
          // çeki listesi boyahaneye "şu renge boya" der → WO.targetColor gösterilir.
          targetColor: { select: { name: true } },
          // Üretim özellikleri de aynı mantıkla çekiye basılır ("bu apreleri uygula").
          // ⚠️ `propertyId` DE seçilir: "YAPILACAK İŞLEMLER" satırı bu listeyi
          // sevkin gittiği ADIMIN istasyon yetenekleriyle KESİŞTİRİR
          // (`resolveStepWorkInstructions`) ve kesişim id üzerinden kurulur.
          targetProperties: { select: { propertyId: true, property: { select: { name: true } } } },
        },
      },
      step: {
        include: {
          station: { select: { name: true, code: true } },
          // "BOYANACAK RENK" satırının adım süzgeci (`resolveStepDyeColor`):
          // renk VERMEYEN kategoriye (örn. Zımpara) boya talimatı gitmesin.
          requiredCategory: { select: { appliesColor: true } },
        },
      },
      items: {
        include: {
          roll: {
            include: {
              item: { select: { code: true, name: true } },
              color: { select: { code: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!dispatch) return null;

  const rolls = dispatch.items.map((item, idx) => ({
    sequence: idx + 1,
    id: item.roll.id,
    barcode: item.roll.barcode,
    itemCode: item.roll.item?.code ?? "",
    itemName: item.roll.item?.name ?? "",
    colorCode: item.roll.color?.code ?? null,
    colorName: item.roll.color?.name ?? null,
    dispatchedQty: Number(item.dispatchedQty),
    dispatchedWeight: item.dispatchedWeight != null ? Number(item.dispatchedWeight) : null,
    qualityGrade: item.roll.qualityGrade ?? "",
    width: item.roll.width != null ? Number(item.roll.width) : null,
  }));

  // "YAPILACAK İŞLEMLER" = iş emri hedefleri ∩ BU ADIMIN istasyon yetenekleri.
  // `dispatch.step` zaten include ile geldi → `stationId` elde, ek sorgu yok
  // (yalnız yetenek satırları okunur). Fail-closed: kesişim boşsa satır basılmaz.
  const works = await resolveStepWorkInstructions(
    db,
    dispatch.step.stationId,
    dispatch.workOrder.targetProperties.map((p) => ({ propertyId: p.propertyId, name: p.property.name })),
  );

  return {
    documentNo: dispatch.dispatchNo,
    voidInfo: dispatch.cancelledAt
      ? { reason: dispatch.cancelReason, at: dispatch.cancelledAt }
      : null,
    doc: assembleFasonCekiDoc({
      dispatchNo: dispatch.dispatchNo,
      dispatchedAt: dispatch.dispatchedAt.toISOString(),
      driverName: dispatch.driverName,
      plateNumber: dispatch.plateNumber,
      notes: dispatch.notes,
      // Fason talimatı çekiye DONAR: sevkin kendi talimatı, yoksa adımın notu.
      // (overlay precedence'ı ile aynı; "Revize Et" yeni talimatla yeniden dondurur.)
      instruction: dispatch.instruction ?? dispatch.step.notes ?? null,
      workOrder: {
        id: dispatch.workOrder.id,
        workOrderNumber: dispatch.workOrder.workOrderNumber,
        parameters: (dispatch.workOrder.parameters as Record<string, unknown> | null) ?? null,
        type: dispatch.workOrder.type,
        width: dispatch.workOrder.width != null ? Number(dispatch.workOrder.width) : null,
      },
      subcontractor: {
        id: dispatch.subcontractor.id,
        name: dispatch.subcontractor.name,
        code: dispatch.subcontractor.code ?? null,
      },
      requestedColor: dispatch.workOrder.targetColor?.name ?? null,
      targetProperties: dispatch.workOrder.targetProperties.map((p) => p.property.name),
      // ⚠️ Renk BURADA fallback TAŞIMAZ (`requestedColor` ile aynı ifade gibi
      // görünüyor ama anlamı farklı ve öyle kalmalı): "BOYANACAK RENK" etiketi
      // yalnız GERÇEK hedefe basılabilir. Hedef yoksa satır hiç doğmaz.
      // ⚠️ Ayrıca ADIMA süzülür: renk vermeyen kategorideki adıma (Zımpara)
      // yapılan sevkin çekisinde boya talimatı BASILMAZ (`resolveStepDyeColor`).
      commands: {
        color: resolveStepDyeColor(dispatch.step, dispatch.workOrder.targetColor?.name ?? null),
        works,
      },
      batchNumber: dispatch.batch?.batchNumber ?? null,
      step: {
        id: dispatch.step.id,
        stepSequence: dispatch.step.stepSequence,
        station: { name: dispatch.step.station.name, code: dispatch.step.station.code },
      },
      rolls,
      totalQty: Number(dispatch.totalQty),
    }),
  };
}

registerPrintedDocBuilder(PrintedDocType.SUBCONTRACTOR_DISPATCH, {
  fresh: buildFasonDispatchDoc,
  // Tek-kaynak "KUMAŞ İRSALİYESİ" HTML — mobil + Electron aynısını basar.
  renderHtml: renderFasonCekiHtml,
  // Belge şablon profili: sevkin fason firmasına atanmış profil (yoksa genel ayar).
  resolveProfileId: async (db, sourceId) => {
    const d = await db.subcontractorDispatch.findUnique({
      where: { id: sourceId },
      select: { subcontractor: { select: { documentProfileId: true } } },
    });
    return d?.subcontractor?.documentProfileId ?? null;
  },
});

// =============================================================================
// RESMİ BELGE — Fasondan Doğrudan Sevk İrsaliyesi (PrintedDocument)
// =============================================================================
// Fason sevk irsaliyesinden AYRI belge zinciri (mal MÜŞTERİYE gidiyor, fasona
// değil). sourceId = DirectShipment.id — belge YALNIZ o olayın toplarını +
// müşteriyi + doğrudan-sevk meta'sını (sebep/tarih) + varsa karşılanan sipariş
// satırlarını gösterir. Kısmi/çoklu doğrudan sevkte her olay ayrı belge.
async function buildFasonDirectShipDoc(
  db: PrintedDocDb,
  directShipmentId: string
): Promise<BuiltDocContent | null> {
  const ds = await db.directShipment.findUnique({
    where: { id: directShipmentId },
    include: {
      customer: { select: { id: true, name: true, code: true, taxNumber: true, exportCode: true } },
      branch: { select: { id: true, name: true, code: true } },
      shippedBy: { select: { fullName: true, username: true } },
      dispatch: {
        select: {
          dispatchNo: true,
          dispatchedAt: true,
          driverName: true,
          plateNumber: true,
          notes: true,
          // K10: bir sevk = bir parti. Bu belge MÜŞTERİYE gittiği için parti
          // varsayılan olarak BASILMAZ (opt-in — `sections.batchInfo === true`).
          batch: { select: { batchNumber: true } },
          subcontractor: { select: { id: true, name: true, code: true } },
          workOrder: { select: { id: true, workOrderNumber: true, parameters: true, type: true } },
          step: {
            select: { id: true, stepSequence: true, station: { select: { name: true, code: true } } },
          },
        },
      },
      rolls: {
        select: {
          id: true,
          barcode: true,
          currentQty: true,
          qualityGrade: true,
          width: true,
          item: { select: { code: true, name: true } },
          color: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      allocations: {
        include: {
          orderLine: {
            select: {
              quantity: true,
              item: { select: { code: true, name: true } },
              color: { select: { name: true } },
              order: { select: { orderNumber: true } },
            },
          },
        },
      },
    },
  });
  if (!ds) return null;

  // Doğrudan sevk edilen toplar = DirectShipment'a bağlı (bölünmüşse çocuk) toplar;
  // dispatchedQty = topun sevk anındaki currentQty'si (kısmi split'te sevk edilen kısım).
  const rolls = ds.rolls.map((r, idx) => ({
    sequence: idx + 1,
    id: r.id,
    barcode: r.barcode,
    itemCode: r.item?.code ?? "",
    itemName: r.item?.name ?? "",
    colorCode: r.color?.code ?? null,
    colorName: r.color?.name ?? null,
    dispatchedQty: Number(r.currentQty),
    dispatchedWeight: null, // bu aşamada top-başına ağırlık tutulmuyor (yalnız metre)
    qualityGrade: r.qualityGrade,
    width: r.width != null ? Number(r.width) : null,
  }));
  const allocations = ds.allocations.map((a) => ({
    orderNumber: a.orderLine.order.orderNumber,
    itemCode: a.orderLine.item.code,
    itemName: a.orderLine.item.name,
    colorName: a.orderLine.color?.name ?? null,
    qty: Number(a.qty),
  }));

  return {
    documentNo: ds.shipmentNo,
    // Doğrudan sevk terminaldir, iptal yolu yok → voidInfo daima null.
    voidInfo: null,
    doc: {
      directShip: true,
      shipmentNo: ds.shipmentNo,
      dispatchNo: ds.dispatch.dispatchNo,
      directShippedAt: ds.shippedAt.toISOString(),
      directShipReason: ds.reason,
      directShippedBy: ds.shippedBy?.fullName ?? ds.shippedBy?.username ?? null,
      dispatchedAt: ds.dispatch.dispatchedAt.toISOString(),
      driverName: ds.dispatch.driverName,
      plateNumber: ds.dispatch.plateNumber,
      notes: ds.dispatch.notes,
      batchNumber: ds.dispatch.batch?.batchNumber ?? null,
      // Malın gittiği MÜŞTERİ — doğrudan sevk irsaliyesinin asıl alıcısı.
      customer: {
        id: ds.customer.id,
        name: ds.customer.name,
        code: ds.customer.code ?? null,
        taxNumber: ds.customer.taxNumber ?? null,
        branchName: ds.branch?.name ?? null,
        branchCode: ds.branch?.code ?? null,
        // Şirket ihracat kodu — tek "İhracat Kodu" satırına şube ihracat kodu
        // (branchCode) boşsa yedek olarak basılır (branchCode ?? exportCode).
        exportCode: ds.customer.exportCode ?? null,
      },
      workOrder: {
        id: ds.dispatch.workOrder.id,
        workOrderNumber: ds.dispatch.workOrder.workOrderNumber,
        parameters: (ds.dispatch.workOrder.parameters as Record<string, unknown> | null) ?? null,
        type: ds.dispatch.workOrder.type,
      },
      subcontractor: {
        id: ds.dispatch.subcontractor.id,
        name: ds.dispatch.subcontractor.name,
        code: ds.dispatch.subcontractor.code ?? null,
      },
      step: {
        id: ds.dispatch.step.id,
        stepSequence: ds.dispatch.step.stepSequence,
        station: { name: ds.dispatch.step.station.name, code: ds.dispatch.step.station.code },
      },
      rolls,
      allocations,
      totals: {
        rollCount: rolls.length,
        totalQty: Number(ds.totalQty),
        totalWeight: 0,
      },
    },
  };
}

registerPrintedDocBuilder(PrintedDocType.SUBCONTRACTOR_DIRECT_SHIP, {
  fresh: buildFasonDirectShipDoc,
  // Tek-kaynak "DOĞRUDAN SEVK İRSALİYESİ" HTML — getHtml her cihazda aynı çıktıyı verir.
  renderHtml: renderFasonDirectShipHtml,
  // Belge şablon profili: malın gittiği MÜŞTERİNİN profili (irsaliyenin muhatabı).
  resolveProfileId: async (db, sourceId) => {
    const ds = await db.directShipment.findUnique({
      where: { id: sourceId },
      select: { customer: { select: { documentProfileId: true } } },
    });
    return ds?.customer?.documentProfileId ?? null;
  },
});

// =============================================================================
// RESMİ BELGE — Fason Kabul Makbuzu (PrintedDocument)
// =============================================================================
// Fasondan mal DÖNÜŞÜNDE kesilen kabul belgesi. sourceId = SubcontractorReceipt.id.
// Kabul edilen (yeni doğan) toplar + uygulanan renk/apre + fason firmanın verdiği
// irsaliye no (manifestNo). Kabul iptali → belge VOIDED.
async function buildFasonReceiptDoc(
  db: PrintedDocDb,
  receiptId: string,
): Promise<BuiltDocContent | null> {
  const receipt = await db.subcontractorReceipt.findUnique({
    where: { id: receiptId },
    include: {
      subcontractor: { select: { name: true, code: true } },
      workOrder: { select: { workOrderNumber: true } },
      step: { include: { station: { select: { name: true } } } },
      appliedColor: { select: { name: true } },
      appliedProperties: { include: { property: { select: { name: true } } } },
      items: {
        orderBy: { createdAt: "asc" },
        include: {
          newRoll: {
            select: {
              barcode: true,
              width: true,
              item: { select: { name: true } },
              color: { select: { name: true } },
              // Fason dönüşünde doğan top partiyi kaynak sevkten kalıtır
              // (`SubcontractorDispatch.batchId`) → makbuz "hangi parti döndü"yü söyler.
              batch: { select: { batchNumber: true } },
            },
          },
        },
      },
    },
  });
  if (!receipt) return null;

  const rolls = receipt.items.map((it, idx) => ({
    sequence: idx + 1,
    barcode: it.newRoll.barcode,
    itemName: it.newRoll.item?.name ?? "",
    colorName: it.newRoll.color?.name ?? null,
    width: it.newRoll.width != null ? Number(it.newRoll.width) : null,
  }));

  const doc: FasonReceiptDoc = {
    receiptNo: receipt.receiptNo,
    manifestNo: receipt.manifestNo ?? null,
    receivedAt: receipt.receivedAt.toISOString(),
    notes: receipt.notes ?? null,
    subcontractor: {
      name: receipt.subcontractor.name,
      code: receipt.subcontractor.code ?? null,
    },
    workOrder: { workOrderNumber: receipt.workOrder.workOrderNumber },
    stationName: receipt.step.station.name,
    appliedColor: receipt.appliedColor?.name ?? null,
    appliedProperties: receipt.appliedProperties.map((p) => p.property.name),
    // Distinct + sıralı: bir kabul birden fazla sevki (dolayısıyla partiyi) kapsayabilir.
    batchNumbers: [
      ...new Set(
        receipt.items.map((it) => it.newRoll.batch?.batchNumber).filter((b): b is string => !!b),
      ),
    ].sort(),
    rolls,
    totals: { rollCount: rolls.length },
  };

  return {
    documentNo: receipt.receiptNo,
    voidInfo: receipt.cancelledAt
      ? { reason: receipt.cancelReason ?? null, at: receipt.cancelledAt }
      : null,
    doc: doc as unknown as Record<string, unknown>,
  };
}

registerPrintedDocBuilder(PrintedDocType.SUBCONTRACTOR_RECEIPT, {
  fresh: buildFasonReceiptDoc,
  renderHtml: renderFasonReceiptHtml,
  resolveProfileId: async (db, sourceId) => {
    const r = await db.subcontractorReceipt.findUnique({
      where: { id: sourceId },
      select: { subcontractor: { select: { documentProfileId: true } } },
    });
    return r?.subcontractor?.documentProfileId ?? null;
  },
});
