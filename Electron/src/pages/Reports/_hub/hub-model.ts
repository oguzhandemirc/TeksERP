// Rapor Merkezi süzgeç modeli — SAF. Görünürlük kararı burada VERİLMEZ: girdi `centerGroups` çıktısıdır
// (izin · yüzey · modül · rapor kapısı · menü). Burası yalnız kişinin seçtiği daraltmayı uygular.
import type { ReportCatalogEntry, ReportKategoriV2, ReportPersona } from "@/lib/report-catalog";
import { RAPOR_PERSONALARI } from "@/lib/report-catalog";
import type { CenterGroup } from "../_v2/center-model";

export interface HubFilter {
  category: ReportKategoriV2 | null;
  persona: ReportPersona | null;
  term: string;
}

export const EMPTY_FILTER: HubFilter = { category: null, persona: null, term: "" };

export const isFilterActive = (f: HubFilter): boolean => f.category !== null || f.persona !== null || f.term.trim() !== "";

type Includes = (hay: string, needle: string) => boolean;

function entryMatches(e: ReportCatalogEntry, f: HubFilter, includes: Includes): boolean {
  if (f.persona && !e.persona.includes(f.persona)) return false;
  return !f.term.trim() || includes(`${e.baslik} ${e.soru}`, f.term);
}

/** Persona + arama süzülmüş gruplar (kategori HARİÇ) — kategori kartlarının sayacı bunu okur. */
export function narrowGroups(groups: readonly CenterGroup[], f: HubFilter, includes: Includes): CenterGroup[] {
  return groups.map((g) => ({ ...g, entries: g.entries.filter((e) => entryMatches(e, f, includes)) }));
}

/** Listede çizilecek gruplar: persona + arama + kategori; boş grup düşer. */
export function visibleGroups(groups: readonly CenterGroup[], f: HubFilter, includes: Includes): CenterGroup[] {
  return narrowGroups(groups, f, includes).filter((g) => g.entries.length > 0 && (f.category === null || g.key === f.category));
}

/** Görünür raporlarda geçen personalar (katalog sırasıyla) — seçeneksiz persona çipe girmez. */
export function personasIn(groups: readonly CenterGroup[]): ReportPersona[] {
  const seen = new Set(groups.flatMap((g) => g.entries.flatMap((e) => e.persona)));
  return RAPOR_PERSONALARI.filter((p) => seen.has(p));
}
