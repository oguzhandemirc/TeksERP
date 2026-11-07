import { useMemo, type ReactNode } from "react";
import type { FilterDef } from "../FilterBar";
import { FilterRow } from "./FilterRow";
import { splitDefFilters } from "./def-row-filters";

export interface DefFilterRowProps {
  filters: readonly FilterDef[];
  /** Satırda hep duranlar (sırasıyla; tarih varsa önde); geri kalanı "+ Filtre"de. */
  primaryKeys: readonly string[];
  search: string;
  onSearchChange: (v: string) => void;
  placeholder?: string;
  trailing?: ReactNode;
}

/** Yalnız FilterBar tanımlarından kurulan sayfalar için TEK SATIR: `[Ara][birincil…][+ Filtre] … [Temizle][trailing]`. */
export function DefFilterRow({ filters, primaryKeys, search, onSearchChange, placeholder, trailing }: DefFilterRowProps) {
  const split = useMemo(() => splitDefFilters(filters, primaryKeys), [filters, primaryKeys]);
  return <FilterRow search={search} onSearchChange={onSearchChange} placeholder={placeholder} primary={split.primary} more={split.more} trailing={trailing} />;
}
