// =============================================================================
// KALEM BİRİMİ — backend `src/constants/item-unit.ts`in panel İKİZİ
// =============================================================================
// Birim MİKTARIN KAYNAĞINI izler: sevk defteri metredir; yalnız MT satırın
// karşılaması ölçülür (`shippedQty`), kg/adet satırda "ölçülmüyor" gösterilir.
// Yüklem backend ile AYNI şeyi söylemek zorunda — ayrışırsa iki ekran iki cevap verir.

export type ItemUnitCode = "MT" | "KG" | "ADET";

export const ITEM_UNIT_CODES: readonly ItemUnitCode[] = ["MT", "KG", "ADET"];

export const ITEM_UNIT_LABEL: Record<ItemUnitCode, string> = { MT: "m", KG: "kg", ADET: "adet" };

/** Belirsizlikte (eski backend `unit` göndermez) bugünkü davranış: metre. */
export function unitLabel(unit: string | null | undefined): string {
  return ITEM_UNIT_LABEL[(unit ?? "MT") as ItemUnitCode] ?? String(unit);
}

/** Karşılama metre defterinden ölçülebilir mi (`unit == null` → MT). */
export function isMeasuredUnit(unit: string | null | undefined): boolean {
  return unit == null || unit === "MT";
}
