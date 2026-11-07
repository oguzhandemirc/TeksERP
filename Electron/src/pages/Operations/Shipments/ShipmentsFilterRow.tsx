import { useMemo, type ReactNode } from "react";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { persistConfigOf, splitDefFilters, urlToggleRowFilter } from "@/components/data-table/filter-row/def-row-filters";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";
import { SHOW_CANCELLED_PARAM } from "@/hooks/useHideCancelled";

/** Satırda hep duranlar (tarih önde); geri kalanı "+ Filtre"de. */
const PRIMARY_KEYS = ["status", "customerId", "invoiced"];

/** Filtre kaydı: tanımlar + "İptaller dahil" anahtarı; kayıt yokken son 30 gün. */
export function shipmentPersistConfig(filters: readonly FilterDef[]): TableFilterPersistConfig {
  return persistConfigOf(filters, { extraKeys: [SHOW_CANCELLED_PARAM], defaultDate: { field: "createdAt", preset: "last30" } });
}

export interface ShipmentsFilterRowProps {
  filters: FilterDef[];
  search: string;
  onSearchChange: (v: string) => void;
  placeholder: string;
  setShowCancelled: (v: boolean) => void;
  trailing?: ReactNode;
}

/** Sevkiyatlar — TEK SATIR: `[Ara][Tarih][Durum][Müşteri][Fatura][+ Filtre] … [Temizle][Kayıtlı][Sütunlar][Dışa aktar]`. */
export function ShipmentsFilterRow(p: ShipmentsFilterRowProps) {
  const { filters, setShowCancelled } = p;
  const { primary, more } = useMemo(() => {
    const split = splitDefFilters(filters, PRIMARY_KEYS);
    return { primary: split.primary, more: [...split.more, urlToggleRowFilter("iptal", "İptaller dahil", SHOW_CANCELLED_PARAM, setShowCancelled)] };
  }, [filters, setShowCancelled]);
  return <FilterRow search={p.search} onSearchChange={p.onSearchChange} placeholder={p.placeholder} primary={primary} more={more} trailing={p.trailing} />;
}
