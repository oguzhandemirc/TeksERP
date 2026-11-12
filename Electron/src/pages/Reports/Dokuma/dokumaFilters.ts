// =============================================================================
// DOKUMA RAPOR SÜZGEÇLERİ — eksen seçicisinin SAF yarısı
// =============================================================================
// Seçenek listesi sayfanın KENDİ yanıtından kurulur (ayrı bir makine/levent ucu
// `station:read`/`warpbeam:read` isterdi; rapor kitlesinde 403 riski). Pencere
// türetici yardımcıları (makine · vardiya · levent) sayfalarıyla kalktı, 2026-11-12.
// =============================================================================

export interface FilterOption {
  id: string;
  label: string;
}

/** `TÜMÜ` seçimi URL'de ve istekte YOKTUR — bugünkü davranış (süzgeçsiz) budur. */
export const ALL_OPTION = "";

/** Seçilen id'nin etiketi — çıktı başlığına ve süzgeç satırına girer (K10). */
export function optionLabel(options: FilterOption[], id: string): string | null {
  if (!id) return null;
  return options.find((o) => o.id === id)?.label ?? id;
}
