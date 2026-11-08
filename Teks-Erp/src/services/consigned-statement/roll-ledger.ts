// =============================================================================
// EMANET EKSTRESİ — TOP defteri (m): yalnız İÇERİYE GİRİŞ/ÇIKIŞ sınır olayları
// =============================================================================
// Kalan = içerideki emanet (depo + üretim + bizim fasoncumuz). İç dönüşümler (kesim, fason dönüş doğumu,
// üretime alma, transfer) satır değildir; metraj farkları sapma defterinden (`roll_variances`) gelir.
// Kaynaklar: depo/stok defteri (giriş · BRÜT sevk · iptal düşümü + bağlı tersleri) · sapma defteri
// (`reversedAt` → ayrı storno satırı) · fasondan doğrudan sevk (DSK; iptal yolu yok, top terminal).
// =============================================================================
import { Prisma, WarehouseEventType } from "@prisma/client";
import prisma from "../../lib/prisma";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { MOVEMENT_ASC } from "../helpers/warehouse-ledger.helper";
import type { LedgerEvent, StatementColumn, StatementDocument } from "./types";

/** Giriş: mal kabul doğuşu + giriş ölçümü düzeltmesi (`RECEIPT_QTY_REASONS`) + müşteri iadesi ve stornosu. */
export const STATEMENT_IN_REASONS: readonly string[] = [
  STOCK_MOVE_REASON.ENTRY_RECEIPT,
  STOCK_MOVE_REASON.ENTRY_CORRECTION,
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

/**
 * Okunan depo defteri satırları. Fire kolu: top iptali/fire düşümü ve sayım düşümü (`CANCEL*`) — sapma
 * satırına bağlı ADJUST satırı (`rollVarianceId`) OKUNMAZ, sapmanın kendisi okunur (çift sayım yok).
 */
export function rollWarehouseLedgerWhere(customerId: string, toAt: Date): Prisma.WarehouseMovementWhereInput {
  return {
    roll: { ownerCustomerId: customerId },
    createdAt: { lte: toAt },
    OR: [
      { reasonCode: { in: [...STATEMENT_IN_REASONS, ...STATEMENT_OUT_REASONS] } },
      { eventType: { in: [WarehouseEventType.CANCEL, WarehouseEventType.CANCEL_REVERSAL] }, rollVarianceId: null },
    ],
  };
}

function columnOfReason(reason: string | null): StatementColumn {
  if (reason && STATEMENT_IN_REASONS.includes(reason)) return "IN";
  if (reason && STATEMENT_OUT_REASONS.includes(reason)) return "OUT";
  return "SCRAP";
}

export async function readRollEvents(customerId: string, toAt: Date): Promise<LedgerEvent[]> {
  const events: LedgerEvent[] = [];

  const moves = await prisma.warehouseMovement.findMany({
    where: rollWarehouseLedgerWhere(customerId, toAt),
    select: {
      id: true, rollId: true, createdAt: true, reasonCode: true, qty: true, toWarehouseId: true, reversesMovementId: true,
      roll: { select: { barcode: true, item: { select: { name: true } } } },
      shipment: { select: { id: true, shipmentNo: true } },
      rollReturn: { select: { id: true, returnNo: true } },
      goodsReceipt: { select: { id: true, receiptNo: true } },
      stockCount: { select: { id: true, countNo: true } },
    },
    orderBy: MOVEMENT_ASC,
  });
  for (const m of moves) {
    // İşaret stok defterinin kendisinden: depolu giriş ucu + (mal içeri), aksi − (receipt-qty emsali).
    const effect = m.toWarehouseId ? m.qty : m.qty.negated();
    const document: StatementDocument | null = m.shipment
      ? { type: "SHIPMENT", id: m.shipment.id, no: m.shipment.shipmentNo }
      : m.rollReturn
        ? { type: "RETURN", id: m.rollReturn.id, no: m.rollReturn.returnNo }
        : m.goodsReceipt
          ? { type: "GOODS_RECEIPT", id: m.goodsReceipt.id, no: m.goodsReceipt.receiptNo }
          : m.stockCount
            ? { type: "STOCK_COUNT", id: m.stockCount.id, no: m.stockCount.countNo }
            : null;
    events.push({
      id: m.id,
      at: m.createdAt,
      subjectId: m.rollId,
      subjectLabel: m.roll.barcode,
      itemName: m.roll.item.name,
      column: columnOfReason(m.reasonCode),
      effect,
      reversal: m.reversesMovementId !== null || REVERSAL_REASONS.has(m.reasonCode ?? ""),
      code: m.reasonCode ?? "UNKNOWN",
      document,
    });
  }

  const variances = await prisma.rollVariance.findMany({
    where: { roll: { ownerCustomerId: customerId }, createdAt: { lte: toAt } },
    select: {
      id: true, rollId: true, kind: true, qty: true, createdAt: true, reversedAt: true,
      roll: { select: { barcode: true, item: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const v of variances) {
    // OVERAGE kalanı artırır (fazla çıkan mal), SCRAP / RECORD_CORRECTION düşürür.
    const effect = v.kind === "OVERAGE" ? v.qty : v.qty.negated();
    const base = { subjectId: v.rollId, subjectLabel: v.roll.barcode, itemName: v.roll.item.name, column: "SCRAP" as const, code: v.kind, document: null };
    events.push({ ...base, id: v.id, at: v.createdAt, effect, reversal: false });
    // Terslenen sapma: ileri satır kendi döneminde KALIR, ters satır terslendiği ana yazılır (as-of).
    if (v.reversedAt && v.reversedAt <= toAt) {
      events.push({ ...base, id: `${v.id}:rev`, at: v.reversedAt, effect: effect.negated(), reversal: true });
    }
  }

  // DSK topu SUBCONTRACTOR_CONSUMED'da terminaldir (düzeltme yolları ALWAYS_BLOCKED) → `currentQty` sevk anının metresidir.
  const dsk = await prisma.roll.findMany({
    where: { ownerCustomerId: customerId, directShipment: { shippedAt: { lte: toAt } } },
    select: {
      id: true, barcode: true, currentQty: true, item: { select: { name: true } },
      directShipment: { select: { id: true, shipmentNo: true, shippedAt: true } },
    },
  });
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
