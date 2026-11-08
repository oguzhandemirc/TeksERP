// =============================================================================
// EMANET EKSTRESİ — TOP defteri (m): HER FİZİKSEL OLAY TAM BİR SATIR
// =============================================================================
// Kalan = içerideki emanet (depo + üretim + bizim fasoncumuz). İç dönüşümler (kesim, fason dönüş doğumu,
// üretime alma, transfer, `PRODUCTION_VARIANCE`) satır değildir.
// İki defter aynı olayı yazabilir; tek taraf seçilir:
//  · SAPMA DEFTERİ (`roll_variances`) metraj farklarının TEK kaynağıdır — giriş ölçümü düzeltmesi, sayım farkı,
//    elle düzeltme, tambur/kurşun/fason farkı. Stok kümesi dışında da yazılır (stok satırı yalnız stoktayken);
//    terslenince `reversedAt` anında ayrı storno satırı.
//  · STOK DEFTERİ yalnız sapmasız SINIR olayları için okunur: giriş doğumu · müşteri iadesi (+ stornosu) · BRÜT
//    sevk (+ stornosu) · top iptali (+ geri alması). Sapmaya bağlı satır (`rollVarianceId`) ve sayım satırı
//    (`stockCountId`; sayım farkının sapma ikizi var, stornosu `reversedAt`) OKUNMAZ.
//  · DSK (fasondan doğrudan sevk): iptal yolu yok, top terminal → `currentQty` sevk anının metresi.
// =============================================================================
import { Prisma, WarehouseEventType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { VARIANCE_SOURCES } from "../../constants/variance-reasons";
import { MOVEMENT_ASC } from "../helpers/warehouse-ledger.helper";
import { mergeOpening } from "./assemble";
import { capRows, type LedgerRead } from "./ledger-read";
import type { LedgerEvent, StatementColumn, StatementDocument, SubjectLabel } from "./types";

/** Giriş sınırı: doğum + müşteri iadesi ve stornosu. Giriş ölçümü düzeltmesi SAPMADAN okunur (aşağıda). */
export const STATEMENT_IN_REASONS: readonly string[] = [
  STOCK_MOVE_REASON.ENTRY_RECEIPT,
  STOCK_MOVE_REASON.CUSTOMER_RETURN,
  STOCK_MOVE_REASON.RETURN_CANCEL,
];
/** Çıkış BRÜT: sevk satırı; storno ayrı satır. */
export const STATEMENT_OUT_REASONS: readonly string[] = [STOCK_MOVE_REASON.SHIPMENT_DISPATCH, STOCK_MOVE_REASON.SHIPMENT_CANCEL];
/** Ters kayıt sebep kodları — bağ (`reversesMovementId`) olmayan eski satırlar da storno sayılsın. */
const REVERSAL_REASONS = new Set<string>([
  STOCK_MOVE_REASON.SHIPMENT_CANCEL,
  STOCK_MOVE_REASON.RETURN_CANCEL,
  STOCK_MOVE_REASON.CANCEL_RESTORE,
]);

/** Okunan stok defteri satırları (tek yüklem — açılış toplamı ve dönem satırları aynı kümeden). */
export function rollWarehouseLedgerWhere(customerId: string): Prisma.WarehouseMovementWhereInput {
  return {
    roll: { ownerCustomerId: customerId },
    // Sapmaya bağlı satırın olayı sapma defterinden okunur (çift sayım yok).
    rollVarianceId: null,
    OR: [
      { reasonCode: { in: [...STATEMENT_IN_REASONS, ...STATEMENT_OUT_REASONS] } },
      // Top iptali ve geri alması; sayım düşümünün olayı sayım sapmasıdır.
      { eventType: { in: [WarehouseEventType.CANCEL, WarehouseEventType.CANCEL_REVERSAL] }, stockCountId: null },
    ],
  };
}

function columnOfReason(reason: string | null): StatementColumn {
  if (reason && STATEMENT_IN_REASONS.includes(reason)) return "IN";
  if (reason && STATEMENT_OUT_REASONS.includes(reason)) return "OUT";
  return "SCRAP";
}

/** Sapma kolonu: giriş ölçümü düzeltmesi girişi düzeltir (IN), gerisi fire/kayıt düzeltmesi (SCRAP). */
function varianceColumn(source: string): StatementColumn {
  return source === VARIANCE_SOURCES.ENTRY_QTY_CORRECTION ? "IN" : "SCRAP";
}
function varianceCode(source: string, kind: string): string {
  if (source === VARIANCE_SOURCES.ENTRY_QTY_CORRECTION) return "ENTRY_CORRECTION";
  if (source === VARIANCE_SOURCES.STOCK_COUNT) return "STOCK_COUNT";
  return kind;
}
/** OVERAGE kalanı artırır (fazla çıkan mal), SCRAP / RECORD_CORRECTION düşürür. */
const varianceSign = (kind: string): 1 | -1 => (kind === "OVERAGE" ? 1 : -1);

async function warehouseOpening(customerId: string, fromAt: Date) {
  const base = { ...rollWarehouseLedgerWhere(customerId), createdAt: { lt: fromAt } };
  // İşaret stok defterinin kendisinden: depolu giriş ucu + (mal içeri), aksi −.
  const inbound = await prisma.warehouseMovement.groupBy({ by: ["rollId"], where: { ...base, toWarehouseId: { not: null } }, _sum: { qty: true } });
  const outbound = await prisma.warehouseMovement.groupBy({ by: ["rollId"], where: { ...base, toWarehouseId: null }, _sum: { qty: true } });
  return [
    ...inbound.map((g) => ({ subjectId: g.rollId, qty: new Prisma.Decimal(g._sum.qty ?? 0) })),
    ...outbound.map((g) => ({ subjectId: g.rollId, qty: new Prisma.Decimal(g._sum.qty ?? 0).negated() })),
  ];
}

async function varianceOpening(customerId: string, fromAt: Date) {
  const owner = { roll: { ownerCustomerId: customerId } };
  const born = await prisma.rollVariance.groupBy({ by: ["rollId", "kind"], where: { ...owner, createdAt: { lt: fromAt } }, _sum: { qty: true } });
  // `fromAt` öncesi terslenen sapma açılışta net sıfırdır (ileri + ters).
  const reversed = await prisma.rollVariance.groupBy({ by: ["rollId", "kind"], where: { ...owner, reversedAt: { lt: fromAt } }, _sum: { qty: true } });
  return [
    ...born.map((g) => ({ subjectId: g.rollId, qty: new Prisma.Decimal(g._sum.qty ?? 0).mul(varianceSign(g.kind)) })),
    ...reversed.map((g) => ({ subjectId: g.rollId, qty: new Prisma.Decimal(g._sum.qty ?? 0).mul(-varianceSign(g.kind)) })),
  ];
}

async function dskOpening(customerId: string, fromAt: Date) {
  const rows = await prisma.roll.findMany({
    where: { ownerCustomerId: customerId, directShipment: { shippedAt: { lt: fromAt } } },
    select: { id: true, currentQty: true },
  });
  return rows.map((r) => ({ subjectId: r.id, qty: r.currentQty.negated() }));
}

type Period = { gte: Date; lte: Date };
const rollSel = { select: { barcode: true, item: { select: { name: true } } } } as const;

async function readVarianceEvents(customerId: string, period: Period, limit: number): Promise<LedgerEvent[]> {
  const events: LedgerEvent[] = [];
  const varSel = {
    id: true, rollId: true, kind: true, qty: true, source: true, sourceRefId: true, createdAt: true, reversedAt: true, roll: rollSel,
  } as const;
  const owner = { roll: { ownerCustomerId: customerId } };
  const born = capRows(await prisma.rollVariance.findMany({ where: { ...owner, createdAt: period }, select: varSel, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit + 1 }), limit);
  const reversed = capRows(await prisma.rollVariance.findMany({ where: { ...owner, reversedAt: period }, select: varSel, orderBy: [{ reversedAt: "asc" }, { id: "asc" }], take: limit + 1 }), limit);
  const countIds = [...new Set([...born, ...reversed].filter((v) => v.source === VARIANCE_SOURCES.STOCK_COUNT && v.sourceRefId).map((v) => v.sourceRefId!))];
  const counts = new Map(
    (countIds.length > 0 ? await prisma.stockCount.findMany({ where: { id: { in: countIds } }, select: { id: true, countNo: true } }) : []).map((c) => [c.id, c.countNo]),
  );
  const varianceEvent = (v: (typeof born)[number], rev: boolean): LedgerEvent => {
    const effect = v.qty.mul(varianceSign(v.kind));
    const countNo = v.sourceRefId ? counts.get(v.sourceRefId) : undefined;
    return {
      id: rev ? `${v.id}:rev` : v.id,
      at: rev ? v.reversedAt! : v.createdAt,
      subjectId: v.rollId,
      subjectLabel: v.roll.barcode,
      itemName: v.roll.item.name,
      column: varianceColumn(v.source),
      // Terslenen sapma: ileri satır kendi döneminde KALIR, ters satır terslendiği ana yazılır (as-of).
      effect: rev ? effect.negated() : effect,
      reversal: rev,
      code: varianceCode(v.source, v.kind),
      document: countNo !== undefined ? { type: "STOCK_COUNT", id: v.sourceRefId!, no: countNo } : null,
    };
  };
  for (const v of born) events.push(varianceEvent(v, false));
  for (const v of reversed) events.push(varianceEvent(v, true));

  return events;
}

async function readDskEvents(customerId: string, period: Period, limit: number): Promise<LedgerEvent[]> {
  const events: LedgerEvent[] = [];
  const dsk = capRows(await prisma.roll.findMany({
    where: { ownerCustomerId: customerId, directShipment: { shippedAt: period } },
    select: { id: true, barcode: true, currentQty: true, item: { select: { name: true } }, directShipment: { select: { id: true, shipmentNo: true, shippedAt: true } } },
    take: limit + 1,
  }), limit);
  for (const r of dsk) {
    const ds = r.directShipment!;
    events.push({
      id: `${ds.id}:${r.id}`,
      at: ds.shippedAt,
      subjectId: r.id,
      subjectLabel: r.barcode,
      itemName: r.item.name,
      column: "DSK",
      effect: r.currentQty.negated(),
      reversal: false,
      code: "DIRECT_SHIPMENT",
      document: { type: "DIRECT_SHIPMENT", id: ds.id, no: ds.shipmentNo },
    });
  }
  return events;
}

export async function readRollLedger(customerId: string, fromAt: Date, toAt: Date, limit: number): Promise<LedgerRead> {
  const opening = mergeOpening([
    ...(await warehouseOpening(customerId, fromAt)),
    ...(await varianceOpening(customerId, fromAt)),
    ...(await dskOpening(customerId, fromAt)),
  ]);
  const events: LedgerEvent[] = [];
  const period = { gte: fromAt, lte: toAt };

  const moves = capRows(await prisma.warehouseMovement.findMany({
    where: { ...rollWarehouseLedgerWhere(customerId), createdAt: period },
    select: {
      id: true, rollId: true, createdAt: true, reasonCode: true, qty: true, toWarehouseId: true, reversesMovementId: true,
      roll: rollSel,
      shipment: { select: { id: true, shipmentNo: true } },
      rollReturn: { select: { id: true, returnNo: true } },
      goodsReceipt: { select: { id: true, receiptNo: true } },
    },
    orderBy: MOVEMENT_ASC,
    take: limit + 1,
  }), limit);
  for (const m of moves) {
    const document: StatementDocument | null = m.shipment
      ? { type: "SHIPMENT", id: m.shipment.id, no: m.shipment.shipmentNo }
      : m.rollReturn
        ? { type: "RETURN", id: m.rollReturn.id, no: m.rollReturn.returnNo }
        : m.goodsReceipt
          ? { type: "GOODS_RECEIPT", id: m.goodsReceipt.id, no: m.goodsReceipt.receiptNo }
          : null;
    events.push({
      id: m.id,
      at: m.createdAt,
      subjectId: m.rollId,
      subjectLabel: m.roll.barcode,
      itemName: m.roll.item.name,
      column: columnOfReason(m.reasonCode),
      effect: m.toWarehouseId ? m.qty : m.qty.negated(),
      reversal: m.reversesMovementId !== null || REVERSAL_REASONS.has(m.reasonCode ?? ""),
      code: m.reasonCode ?? "UNKNOWN",
      document,
    });
  }

  events.push(...(await readVarianceEvents(customerId, period, limit)));
  events.push(...(await readDskEvents(customerId, period, limit)));
  return { opening, events };
}

export async function readRollLabels(ids: readonly string[]): Promise<Map<string, SubjectLabel>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.roll.findMany({ where: { id: { in: [...ids] } }, select: { id: true, barcode: true, item: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.id, { label: r.barcode, itemName: r.item.name }]));
}
