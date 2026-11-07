import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { dateRowFilter, persistConfigOf, splitDefFilters, urlToggleRowFilter } from "@/components/data-table/filter-row/def-row-filters";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";
import { buildRollFilterDefs, DATE_FILTER, KARTELA_MARKED_PARAM } from "./roll-filter-defs";
import type { RollStatusTabKey } from "./service";

/** "Fire kaliteyi de göster" — liste ve özet şeridi aynı anahtarı okur (sunucu süzer). */
export const INCLUDE_FIRE_PARAM = "filter[includeFire]";

/** Satırda hep duranlar (tarih önde, sekmede varsa); geri kalanı "+ Filtre"de. */
const PRIMARY_KEYS = ["itemId", "colorId", "shipmentScope", "subcontractorId", "subcontractorCategoryId", "currentStationId", "statusIn"];

/**
 * Kayıt allowlist'i SEKME BAŞINA (anahtar `rolls:<sekme>`): sekmenin bütün tanımları + Fire; Bitmiş
 * Depo'da Kartelalık. Kat kataloğu / depo yüklenmeden de tam küme (yoksa açılışta düşerdi).
 * Sekme değişince bu küme eski sekmenin süzgecini URL'den siler.
 */
export function rollPersistConfig(tab: RollStatusTabKey): TableFilterPersistConfig {
  const all = buildRollFilterDefs(tab, [{ value: "*", label: "*" }], true);
  const extra = tab === "FINISHED_STOCK" ? [INCLUDE_FIRE_PARAM, KARTELA_MARKED_PARAM] : [INCLUDE_FIRE_PARAM];
  return persistConfigOf(all, { extraFilterKeys: extra });
}

/** "Fire dahil" kutusu (✕ / Temizle siler). Kartela da aynısını kullanır. */
export function useIncludeFireRowFilter() {
  const [sp, setSp] = useSearchParams();
  const set = (on: boolean) => {
    const next = new URLSearchParams(sp);
    if (on) next.set(INCLUDE_FIRE_PARAM, "true");
    else next.delete(INCLUDE_FIRE_PARAM);
    setSp(next, { replace: true });
  };
  return urlToggleRowFilter("fire", "Fire dahil", INCLUDE_FIRE_PARAM, set);
}

export interface RollsFilterRowProps {
  filters: FilterDef[];
  /** Okutma/arama alanı (arama kutusunun yerine). */
  leading: ReactNode;
  trailing?: ReactNode;
}

/** Kumaş Stoğu — TEK SATIR: `[Okut·Ara][Tarih][Kumaş][Renk][sekmeye özgü][+ Filtre] … [Temizle][trailing]`. */
export function RollsFilterRow({ filters, leading, trailing }: RollsFilterRowProps) {
  const fire = useIncludeFireRowFilter();
  const split = splitDefFilters(filters, PRIMARY_KEYS);
  return <FilterRow leading={leading} primary={[dateRowFilter(DATE_FILTER), ...split.primary]} more={[...split.more, fire]} trailing={trailing} />;
}
