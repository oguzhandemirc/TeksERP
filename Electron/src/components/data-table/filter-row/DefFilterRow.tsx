import { useMemo, type ReactNode } from "react";
import type { FilterDef } from "../FilterBar";
import { FilterRow, type ListTools } from "./FilterRow";
import { splitDefFilters } from "./def-row-filters";

export interface DefFilterRowProps {
  filters: readonly FilterDef[];
  /** İlk açılışta satırda görünenler (sırasıyla; tarih varsa önde); geri kalanı "+ Filtre"de. Kullanıcı tikle değiştirir. */
  primaryKeys: readonly string[];
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  searchHint?: string;
  trailing?: ReactNode;
  /** Standart "Sütunlar" + "Dışa aktar" (FilterRow `tools`). */
  tools?: ListTools;
}

/** Yalnız FilterBar tanımlarından kurulan sayfalar için TEK SATIR: `[Ara][birincil…][+ Filtre] … [Temizle][trailing]`. */
export function DefFilterRow({ filters, primaryKeys, search, onSearchChange, placeholder, searchHint, trailing, tools }: DefFilterRowProps) {
  const split = useMemo(() => splitDefFilters(filters, primaryKeys), [filters, primaryKeys]);
  return <FilterRow search={search} onSearchChange={onSearchChange} placeholder={placeholder} searchHint={searchHint} tools={tools} primary={split.primary} more={split.more} trailing={trailing} />;
}
