import apiClient from "@/services/apiClient";
import type { SearchRow } from "./search-targets";

// =============================================================================
// GLOBAL ARAMA İSTEMCİSİ — `GET /api/search` (2026-08-19)
// =============================================================================
// ⚠️ Tek istek, tek iptal noktası. Varlık başına ayrı istek atmak izinsiz
// kovalarda 403 + toast üretir ve debounce'la yarışan kısmi sonuçlar karışır.
// =============================================================================

export interface SearchGroup {
  entity: string;
  label: string;
  rows: SearchRow[];
  /** Sunucu `take: limit+1` ile ölçüyor — toplam sayım DÖNMEZ (maliyet). */
  hasMore: boolean;
}

export interface GlobalSearchResult {
  term: string;
  /** Tam-format barkod okundu: tek deterministik sonuç, gruplar boş. */
  exact: { entity: string; row: SearchRow } | null;
  groups: SearchGroup[];
}

export async function globalSearch(term: string): Promise<GlobalSearchResult> {
  const res = await apiClient.get<{ data: GlobalSearchResult }>(`/api/search?q=${encodeURIComponent(term)}`);
  return res.data?.data ?? { term, exact: null, groups: [] };
}
