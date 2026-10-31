// Ürüne uygulanacak terbiye tarifesi kodu — TEK kural: varyant (ProductRecipe) varsa o, yoksa ürün yapısı
// (CostStructure). Maliyet derleyicisi (ürün düzeyi, varyantsız) ve üretim önerisi (çekme) aynı sırayı okur.

/** Boş/null kod "tanımsız" sayılır; sıradaki kaynağa düşülür. */
export function effectiveFinishingRateCode(recipeCode: string | null | undefined, structureCode: string | null | undefined): string | null {
  return recipeCode || structureCode || null;
}
