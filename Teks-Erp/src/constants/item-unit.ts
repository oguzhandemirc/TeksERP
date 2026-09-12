// =============================================================================
// KALEM BİRİMİ — tek etiket sözlüğü ve "karşılama ölçülür mü" yüklemi
// =============================================================================
// `ItemUnit` enum kodu (MT/KG/ADET) ile belgeye basılan etiket ("m"/"kg"/"adet")
// iki ayrı sözlükten okunuyordu (mal kabul faturası enum kodunu, sevk taslağı
// "m"i yazıyordu). Aynı soruyu cevaplayan koşul tek yerde yaşar.
//
// Birim MİKTARIN KAYNAĞINI izler: sevk defteri (`Roll.currentQty`,
// `SackAllocation.qty`) METRE tutar. Bu yüzden yalnız MT satırın karşılaması
// defterden ölçülür; KG/ADET satırda `shippedQty` yazılmaz, sipariş
// kendiliğinden kapanmaz ve yüzeyler "ölçülmüyor" der.
import { ItemUnit } from "@prisma/client";

/** Enum kodu → belge/ekran etiketi. */
export const ITEM_UNIT_LABEL: Record<ItemUnit, string> = {
  MT: "m",
  KG: "kg",
  ADET: "adet",
};

/** Sevk defterinin birimi — `Roll.currentQty` / `SackAllocation.qty` metredir. */
export const LEDGER_UNIT: ItemUnit = ItemUnit.MT;

/**
 * Satırın karşılaması metre defterinden ÖLÇÜLEBİLİR mi.
 * `null`/`undefined` → MT (alanı seçmeyen çağıran bugünkü davranışı alır;
 * `cancelledAt` gevşek-karşılaştırma dersinin aynısı).
 */
export function isMeasuredUnit(unit: ItemUnit | null | undefined): boolean {
  return unit == null || unit === LEDGER_UNIT;
}

/** Enum üyeliği — dış girdi (`ORDER_LINE_WRITABLE.unit`) için. */
export function isItemUnit(v: unknown): v is ItemUnit {
  return typeof v === "string" && (Object.values(ItemUnit) as string[]).includes(v);
}

export function unitLabel(unit: ItemUnit | null | undefined): string {
  return ITEM_UNIT_LABEL[unit ?? LEDGER_UNIT];
}
