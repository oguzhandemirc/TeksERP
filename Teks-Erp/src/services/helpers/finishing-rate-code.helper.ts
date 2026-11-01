// =============================================================================
// TERBİYE TARİFE KODU ÇÖZÜMÜ — tek kaynak (SY-E1 önceliği, SY-E2 fason kg kontrolü)
// =============================================================================
// "Bu ürün/varyant hangi terbiye tarifesiyle fiyatlanır?" sorusunun TEK cevabı: varyant kodu >
// ürün yapısı kodu > yok (tasarım §6.5). Maliyet derleyicisi ve fason sevk kg kontrolü aynı
// yüklemi okur; ayrı kopya varyant önceliğini sessizce tersine çevirebilir.
// =============================================================================

/** Varyantın (`ProductRecipe.finishingRateCode`) kodu doluysa o, değilse ürün yapısınınki, ikisi de yoksa null. */
export function resolveFinishingRateCode(variantCode: string | null | undefined, structureCode: string | null | undefined): string | null {
  return variantCode ?? structureCode ?? null;
}
