// =============================================================================
// TÜRKÇE SIRALAMA — tek collator (2026-08-19)
// =============================================================================
// ⚠️ SIRALAMA ile ARAMA ters şeyler ister ve karıştırılırsa liste yanlış çıkar:
//   • ARAMA katlar   → ç ≡ c, ı ≡ i  (`lib/search-fold.ts` / SQL `tr_fold`)
//   • SIRALAMA AYIRIR → ç ≠ c, Ç bütün C'lerden SONRA gelir
// Katlanmış anahtarla sıralanan bir liste "Çanakkale"yi "Cebeci"nin bile önüne
// atar. Bu dosya sıralama tarafının tek kaynağıdır.
//
// ⚠️ MODÜL SABİTİ olması önemli: `Array.sort` comparator'ının İÇİNDE
// `localeCompare` çağırmak her karşılaştırmada yeni bir collator kurar —
// n·log n kez. Collator'ı bir kez kurup `compare`'ini geçmek aynı işi yapar.
//
// ⚠️ `numeric: true`: "SIP-2" < "SIP-10" (sözlüksel sırada tersi olurdu ve
// belge numarası listeleri gözle yanlış görünürdü).
//
// DB tarafındaki karşılığı `COLLATE public.tr_sort` (ICU 'tr') — sunucudan
// sıralı gelen liste ile istemcide sıralanan liste aynı sırayı vermeli.
// =============================================================================

export const TR_COLLATOR = new Intl.Collator("tr", { numeric: true });

/** Türkçe karşılaştırma — `Array.prototype.sort` comparator'ı olarak kullanılır. */
export function trCompare(a: string | null | undefined, b: string | null | undefined): number {
  return TR_COLLATOR.compare(a ?? "", b ?? "");
}
