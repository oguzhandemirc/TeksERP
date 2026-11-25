// ÜRÜN KARTI D4b (Seyitoğlu denetimi, 2026-11-25): kumaş ticari · iplik teknik · asgari stok · sarf birimi.
// `BaseController` skalerleri olduğu için doğrulama AÇIKÇA burada; tip dışı DOLU değer 400 (null/"" her tipte temizler).
// DB CHECK'leri (`items_fabric_trade_ck` · `items_yarn_spec_ck` · `items_min_stock_qty_ck`) ikinci hat.
import { ItemType, ItemUnit, Prisma, YarnLuster, YarnTwistDirection } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { parseDecimalField, parseTextField } from "./cost-input.helper";

const has = (data: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(data, k);

/** Kumaş ticari alanları — `item.service` FABRIC_STRUCTURE_KEYS'e katılır (tip kapısı orada, tek mesaj). */
export const FABRIC_TRADE_KEYS = ["standardRollLengthM", "minOrderQty", "careInstructions"] as const;

export function readFabricTradeFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (has(data, "standardRollLengthM")) {
    out.standardRollLengthM = parseDecimalField(data.standardRollLengthM, { label: "Top boyu (m)", min: 0, minExclusive: true, max: 100000, scale: 2 }) ?? null;
  }
  if (has(data, "minOrderQty")) {
    out.minOrderQty = parseDecimalField(data.minOrderQty, { label: "Asgari sipariş", min: 0, minExclusive: true, max: 9999999999, scale: 2 }) ?? null;
  }
  if (has(data, "careInstructions")) out.careInstructions = parseTextField(data.careInstructions, "Bakım talimatı", 500) ?? null;
  return out;
}

export const YARN_SPEC_KEYS = ["yarnFilamentCount", "yarnPly", "yarnTwistTpm", "yarnTwistDirection", "yarnLuster"] as const;

function readInt(raw: unknown, label: string, min: number, max: number): number | null {
  const d = parseDecimalField(raw, { label, min, max, scale: 0, integer: true });
  return d == null ? null : d.toNumber();
}

function readEnum<T extends string>(raw: unknown, values: readonly T[], msg: string, code: string): T | null {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string" || !(values as readonly string[]).includes(raw)) throw AppError.badRequest(msg, { code });
  return raw as T;
}

/** İplik teknik alanları: filament ≥ 1, kat 1..20, büküm 0..5000 tur/m; yön S/Z; parlaklık üç değer. Yalnız İPLİK. */
export function readYarnSpecFields(itemType: string | undefined, data: Record<string, unknown>): Record<string, unknown> {
  if (!YARN_SPEC_KEYS.some((k) => has(data, k))) return {};
  const out: Record<string, unknown> = {};
  if (has(data, "yarnFilamentCount")) out.yarnFilamentCount = readInt(data.yarnFilamentCount, "Filament sayısı", 1, 100000);
  if (has(data, "yarnPly")) out.yarnPly = readInt(data.yarnPly, "Kat", 1, 20);
  if (has(data, "yarnTwistTpm")) out.yarnTwistTpm = readInt(data.yarnTwistTpm, "Büküm (tur/m)", 0, 5000);
  if (has(data, "yarnTwistDirection")) {
    out.yarnTwistDirection = readEnum(data.yarnTwistDirection, Object.values(YarnTwistDirection), "Büküm yönü S ya da Z olmalı.", "YARN_TWIST_DIRECTION_INVALID");
  }
  if (has(data, "yarnLuster")) {
    out.yarnLuster = readEnum(data.yarnLuster, Object.values(YarnLuster), "Parlaklık Parlak / Yarı mat / Mat olmalı.", "YARN_LUSTER_INVALID");
  }
  if (itemType !== undefined && itemType !== ItemType.YARN && Object.values(out).some((v) => v !== null)) {
    throw AppError.badRequest("Filament/kat/büküm/parlaklık yalnız İPLİK kartına girilir", { code: "ITEM_YARN_SPEC_YARN_ONLY" });
  }
  return out;
}

/** Asgari stok (kartın biriminde, > 0) — yalnız İPLİK ve SARF. */
export function readMinStockField(itemType: string | undefined, data: Record<string, unknown>): { minStockQty?: Prisma.Decimal | null } {
  if (!has(data, "minStockQty")) return {};
  const v = parseDecimalField(data.minStockQty, { label: "Asgari stok", min: 0, minExclusive: true, max: 99999999999, scale: 3 }) ?? null;
  if (v !== null && itemType !== undefined && itemType !== ItemType.YARN && itemType !== ItemType.CONSUMABLE) {
    throw AppError.badRequest("Asgari stok yalnız İPLİK ve SARF kartına girilir", { code: "ITEM_MIN_STOCK_TYPE" });
  }
  return { minStockQty: v };
}

/**
 * Birim değişimi (K9: sarfta kg/litre/metre seçimi). Sarf defteri (`consumable_movements`) ve tüketim normları
 * miktarı KARTIN birimiyle tutar → hareketi/normu olan sarfın birimi değişirse geçmiş miktarlar anlam değiştirir: 400.
 */
export async function assertUnitChangeAllowed(itemId: string, raw: unknown): Promise<void> {
  if (raw === undefined) return;
  if (typeof raw !== "string" || !(Object.values(ItemUnit) as string[]).includes(raw)) {
    throw AppError.badRequest("Birim MT / KG / ADET olmalı.", { code: "ITEM_UNIT_INVALID" });
  }
  const cur = await prisma.item.findUnique({ where: { id: itemId }, select: { unit: true, itemType: true } });
  if (!cur || cur.unit === raw || cur.itemType !== ItemType.CONSUMABLE) return;
  const moves = await prisma.consumableMovement.count({ where: { itemId } });
  const norms = await prisma.serviceConsumableNorm.count({ where: { consumableItemId: itemId } });
  if (moves + norms > 0) {
    throw AppError.badRequest("Bu sarfın stok hareketi ya da tüketim normu var; birimi değiştirilemez. Yeni birimle yeni kart açın.", { code: "ITEM_UNIT_LOCKED" });
  }
}
