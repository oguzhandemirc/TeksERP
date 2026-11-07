// Cariler — Yön × Fason süzgeci URL'de (`filter[direction]` · `filter[subcontractor]`; sunucuya
// AYNEN gitmez, `cariQueryPlan` çevirir) ve kullanıcı başına kayıtlı (`prefs.tableFilters.cariler`).
import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { persistConfigOf, splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import { usePersistedTableFilters } from "@/hooks/usePersistedTableFilters";
import { DIRECTION_OPTIONS, SUBCONTRACTOR_OPTIONS, type DirectionFilter, type SubcontractorFilter } from "@/lib/partnerRoles";
import type { CariFilters } from "./carilerPaging";

export const CARI_TABLE_KEY = "cariler";
const DIRECTION_PARAM = "filter[direction]";
const SUBCONTRACTOR_PARAM = "filter[subcontractor]";

/** "Tümü" seçeneği kutunun boş hâlidir (param yok). */
const withoutAll = <T extends string>(opts: readonly { value: T; label: string }[]) => opts.filter((o) => o.value !== "ALL").map((o) => ({ value: o.value as string, label: o.label }));

export const CARI_ROW_FILTERS: FilterDef[] = [
  { kind: "select", key: "direction", label: "Yön", options: withoutAll(DIRECTION_OPTIONS) },
  { kind: "select", key: "subcontractor", label: "Fason", options: withoutAll(SUBCONTRACTOR_OPTIONS) },
];
export const CARI_PERSIST = persistConfigOf(CARI_ROW_FILTERS);

/** URL → süzgeç çifti; tanınmayan değer "Tümü" (elle yazılmış bayat URL boş liste vermesin). */
export function cariFilters(d: string | null, s: string | null): CariFilters {
  return {
    direction: (DIRECTION_OPTIONS.some((o) => o.value === d) ? d : "ALL") as DirectionFilter,
    subcontractor: (SUBCONTRACTOR_OPTIONS.some((o) => o.value === s) ? s : "ALL") as SubcontractorFilter,
  };
}

/** Süzgeç + kayıt geri yükleme; `ready` gelene dek sorgular bekler (açılışta tek istek). */
export function useCariFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const persist = usePersistedTableFilters({ tableKey: CARI_TABLE_KEY, config: CARI_PERSIST, searchParams, setSearchParams });
  const dir = searchParams.get(DIRECTION_PARAM);
  const sub = searchParams.get(SUBCONTRACTOR_PARAM);
  // Yalnız iki anahtar değişince yeni nesne — sayfa sıfırlama effect'i buna bağlı.
  const filters = useMemo(() => cariFilters(dir, sub), [dir, sub]);
  return { filters, ready: persist.ready };
}

/** Cariler — TEK SATIR: `[Ara][Yön][Fason] … [Temizle][N kart]`. */
export function CarilerFilterRow({ search, onSearchChange, trailing }: { search: string; onSearchChange: (v: string) => void; trailing?: ReactNode }) {
  const split = useMemo(() => splitDefFilters(CARI_ROW_FILTERS, ["direction", "subcontractor"]), []);
  return <FilterRow search={search} onSearchChange={onSearchChange} placeholder="Ad / kod / vergi no ara…" primary={split.primary} more={split.more} trailing={trailing} />;
}
