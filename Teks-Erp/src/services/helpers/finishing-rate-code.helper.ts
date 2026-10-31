// Ürüne uygulanacak terbiye tarifesi kodu — TEK kural: varyant (ProductRecipe) varsa o, yoksa ürün yapısı
// (CostStructure). Maliyet derleyicisi ve üretim önerisi (çekme) aynı sırayı okur.

/** null kod "tanımsız" sayılır; sıradaki kaynağa düşülür (maliyet derleyicisinin `??` zinciriyle bayt-aynı). */
export function effectiveFinishingRateCode(recipeCode: string | null | undefined, structureCode: string | null | undefined): string | null {
  return recipeCode ?? structureCode ?? null;
}
