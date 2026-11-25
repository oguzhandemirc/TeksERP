// =============================================================================
// SARF STOĞU — okuma yüzeyi (panel: Sarf Stoğu listesi + hareketler)
// =============================================================================
// Yazarlar `helpers/consumable-stock.helper.ts`te (mal kabul, iptal, üretim tüketimi + ters kaydı).
// Bakiye defterden türetilir; eksi bakiye `negative: true` ile işaretlenir (engellemez, uyarır).
// =============================================================================
import { ConsumableMovementKind, ItemLifecycleStatus, ItemType, ItemUnit, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { consumableBalances, consumableMovementSign } from "./helpers/consumable-stock.helper";
import { resolveConsumableStockEnabled } from "./system-setting.service";
import { isBelowMinStock } from "./helpers/min-stock.helper";
import { readIdCondition } from "../utils/query-parser";

export interface ConsumableStockRow {
  itemId: string;
  code: string;
  name: string;
  unit: ItemUnit;
  balance: string;
  negative: boolean;
  isActive: boolean;
  /** Kartın asgari stoğu (kartın biriminde); boş = eşik yok. */
  minStockQty: string | null;
  belowMinStock: boolean;
}

export async function listConsumableStock(o: { search?: string; itemId?: string; belowMin?: boolean } = {}): Promise<{
  enabled: boolean;
  rows: ConsumableStockRow[];
  summary: { itemCount: number; negativeCount: number; belowMinCount: number };
}> {
  const q = o.search?.trim();
  const idCond = readIdCondition(o.itemId);
  const items = await prisma.item.findMany({
    where: {
      itemType: ItemType.CONSUMABLE,
      ...(idCond ? { id: idCond } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, code: true, name: true, unit: true, lifecycleStatus: true, minStockQty: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const bal = await consumableBalances(prisma, items.map((i) => i.id));
  // Arşivlenmiş (pasif) kalem yalnız hareketi varsa görünür (geçmiş bakiyesi kaybolmasın). Bu bir
  // GÖRÜNÜRLÜK kuralıdır, kullanılabilirlik kararı değil (o `assertItemUsable`da).
  const base = items
    .filter((i) => i.lifecycleStatus !== ItemLifecycleStatus.ARCHIVED || bal.has(i.id))
    .map((i) => {
      const b = bal.get(i.id) ?? new Prisma.Decimal(0);
      const isActive = i.lifecycleStatus !== ItemLifecycleStatus.ARCHIVED;
      return {
        itemId: i.id,
        code: i.code,
        name: i.name,
        unit: i.unit,
        balance: b.toFixed(3),
        negative: b.lt(0),
        isActive,
        minStockQty: i.minStockQty?.toFixed(3) ?? null,
        belowMinStock: isBelowMinStock(b, i.minStockQty, !isActive),
      };
    });
  // Asgari altı sayısı FACETED (filtre seçilince liste toplamı); süzme sunucuda, liste + özet aynı satır kümesinden.
  const belowMinCount = base.filter((r) => r.belowMinStock).length;
  const rows = o.belowMin ? base.filter((r) => r.belowMinStock) : base;
  return {
    enabled: await resolveConsumableStockEnabled(),
    rows,
    summary: { itemCount: rows.length, negativeCount: rows.filter((r) => r.negative).length, belowMinCount },
  };
}

const MOVEMENT_LIMIT_MAX = 200;

/** Kalemin hareketleri — yeni → eski, cursor = son satırın id'si (createdAt, id eşitlik bozucusuyla). */
export async function listConsumableMovements(itemId: string, o: { cursor?: string; limit?: number } = {}) {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true, name: true, unit: true, itemType: true } });
  if (!item || item.itemType !== ItemType.CONSUMABLE) {
    throw AppError.notFound("Sarf kalemi bulunamadı.", { code: "CONSUMABLE_ITEM_NOT_FOUND" });
  }
  const limit = Math.min(Math.max(o.limit ?? 50, 1), MOVEMENT_LIMIT_MAX);
  const rows = await prisma.consumableMovement.findMany({
    where: { itemId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(o.cursor ? { cursor: { id: o.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      kind: true,
      qty: true,
      reason: true,
      createdAt: true,
      reversesId: true,
      goodsReceipt: { select: { id: true, receiptNo: true } },
      // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): hareket geçmişi geri alınmış izin tüketimini de gösterir.
      rollOperation: { select: { operationType: true, roll: { select: { id: true, barcode: true } }, step: { select: { workOrder: { select: { id: true, workOrderNumber: true } } } } } },
      reversedBy: { select: { id: true } },
    },
  });
  const page = rows.slice(0, limit);
  return {
    item: { id: item.id, name: item.name, unit: item.unit },
    rows: page.map((m) => ({
      id: m.id,
      kind: m.kind,
      signedQty: m.qty.mul(consumableMovementSign(m.kind)).toFixed(3),
      reason: m.reason,
      createdAt: m.createdAt.toISOString(),
      reversed: m.reversedBy !== null,
      isReversal: m.reversesId !== null,
      receipt: m.goodsReceipt,
      roll: m.rollOperation?.roll ?? null,
      workOrder: m.rollOperation?.step.workOrder ?? null,
      operationType: m.rollOperation?.operationType ?? null,
    })),
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
  };
}

export const CONSUMABLE_MOVEMENT_KINDS = Object.values(ConsumableMovementKind);
