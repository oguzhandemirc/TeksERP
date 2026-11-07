import { useMemo, type ReactNode } from "react";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { localToggleRowFilter, persistConfigOf, splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";
import type { RowFilter } from "@/components/data-table/filter-row/row-filter";
import { STATUS_LOCATION_URL_KEYS, StatusLocationFilter } from "./StatusLocationFilter";
import { PLACE_FILTER_KEYS } from "./work-order-filters";

/** Satırda hep duranlar (Durum kutusu + tarih önde); geri kalanı "+ Filtre"de. */
const PRIMARY_KEYS = ["customerId", "targetItemId"];

/** Filtre kaydı: sabit kutular + fason yeri + Durum/konum; kayıt yokken bugünkü varsayılan (son 30 gün, açılış). */
export function workOrderPersistConfig(filters: readonly FilterDef[]): TableFilterPersistConfig {
  const extraFilterKeys = [...STATUS_LOCATION_URL_KEYS, ...PLACE_FILTER_KEYS.map((k) => `filter[${k}]`)];
  return persistConfigOf(filters, { extraFilterKeys, defaultDate: { field: "createdAt", preset: "last30" } });
}

export interface WorkOrdersFilterRowProps {
  filters: FilterDef[];
  search: string;
  onSearchChange: (v: string) => void;
  placeholder: string;
  showCompleted: boolean;
  setShowCompleted: (v: boolean) => void;
  showCancelled: boolean;
  setShowCancelled: (v: boolean) => void;
  trailing?: ReactNode;
}

/** İş Emirleri — TEK SATIR: `[Ara][Durum][Tarih][Müşteri][Kumaş][+ Filtre] … [Temizle][Kayıtlı][Sütunlar][Dışa aktar]`. */
export function WorkOrdersFilterRow(p: WorkOrdersFilterRowProps) {
  const { filters, showCompleted, setShowCompleted, showCancelled, setShowCancelled } = p;
  const { primary, more } = useMemo(() => {
    const split = splitDefFilters(filters, PRIMARY_KEYS);
    const statusChip: RowFilter = { id: "durum", label: "Durum", keys: STATUS_LOCATION_URL_KEYS, render: ({ autoOpen }) => <StatusLocationFilter chip autoOpen={autoOpen} /> };
    // Tamamlanan/iptal anahtarları makineye kalıcı (useListToggles, localStorage) — URL'ye taşınmadı.
    const toggles = [
      localToggleRowFilter("tamamlanan", "Tamamlananlar dahil", showCompleted, setShowCompleted),
      localToggleRowFilter("iptal", "İptaller dahil", showCancelled, setShowCancelled),
    ];
    return { primary: [statusChip, ...split.primary], more: [...split.more, ...toggles] };
  }, [filters, showCompleted, setShowCompleted, showCancelled, setShowCancelled]);

  return <FilterRow search={p.search} onSearchChange={p.onSearchChange} placeholder={p.placeholder} primary={primary} more={more} trailing={p.trailing} />;
}
