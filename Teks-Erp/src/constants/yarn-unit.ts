// =============================================================================
// İPLİK SATIN ALMA BİRİMİ — tek kaynak (Seyitoğlu SY-a, 2026-11-21)
// =============================================================================
// Pul adetle, payet şerit metreyle alınır; denyesi yoktur ve kg defterine (stok, ihtiyaç, gramaj) girmez.
// `Item.yarnPurchaseUnit` NULL = KG (bugünkü davranış). "Bu iplik kg ile mi hesaplanır" sorusunun TEK cevabı
// burası; motor, atkı/çözgü kartı servisleri ve fiyat yazımı buradan okur.
// =============================================================================
import type { YarnPurchaseUnit } from "@prisma/client";

export const YARN_PURCHASE_UNITS = ["KG", "ADET", "METRE"] as const satisfies readonly YarnPurchaseUnit[];
/** KG dışı birim — maliyet motoru girdisinde (`CostYarn.unit`) yalnız bunlar yazılır. */
export type NonKgYarnUnit = Exclude<YarnPurchaseUnit, "KG">;

export const YARN_PURCHASE_UNIT_LABEL: Record<YarnPurchaseUnit, string> = { KG: "kg", ADET: "adet", METRE: "metre" };

/** Kartın etkin birimi: NULL = KG. */
export function effectiveYarnUnit(item: { yarnPurchaseUnit?: YarnPurchaseUnit | null }): YarnPurchaseUnit {
  return item.yarnPurchaseUnit ?? "KG";
}

/** İplik kg ile hesaplanıyor mu (denye zorunlu, stok/ihtiyaç/gramaj kg'ına girer)? Yalnız KG. */
export function isKgYarnUnit(unit: YarnPurchaseUnit | null | undefined): boolean {
  return (unit ?? "KG") === "KG";
}

/** Maliyet girdisine yazılacak birim — KG'de `undefined` (anahtar yazılmaz → girdi + hash bayt-aynı). */
export function nonKgUnitOf(unit: YarnPurchaseUnit | null | undefined): NonKgYarnUnit | undefined {
  return unit === "ADET" || unit === "METRE" ? unit : undefined;
}
