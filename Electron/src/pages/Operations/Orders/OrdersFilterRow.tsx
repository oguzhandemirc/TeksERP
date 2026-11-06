import { useMemo, type ReactNode } from "react";
import { FilterControl, type FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { DatePresetFilter } from "@/components/data-table/filter-row/DatePresetFilter";
import { keysWithDependents, type RowFilter } from "@/components/data-table/filter-row/row-filter";
import { FASON_FIRMA_KEY, FASON_GUN_KEY, NEREDE_FILTER_KEY } from "./order-nerede";
import { FasonFirmaFilter, FasonGunFilter, OrdersViewSelect } from "./order-where-filters";

/** Satırda hep duran süzgeçler; geri kalanı "+ Filtre"de (kullanıcı tasarımı 2026-11-06). */
const PRIMARY_KEYS = ["customerId", "status"];

export interface OrdersFilterRowProps {
  /** Rejime göre süzülmüş tanımlar (`resolveOrderFilters`) — ticarette üretim süzgeci yok. */
  filters: FilterDef[];
  productionEnabled: boolean;
  search: string;
  onSearchChange: (v: string) => void;
  placeholder: string;
  showCancelled: boolean;
  setShowCancelled: (v: boolean) => void;
  forceFilters: Record<string, string>;
  trailing?: ReactNode;
}

function defFilter(def: Exclude<FilterDef, { kind: "dateRange" }>, all: FilterDef[]): RowFilter {
  return { id: def.key, label: def.label, keys: keysWithDependents(def, all), render: ({ autoOpen }) => <FilterControl def={def} chip autoOpen={autoOpen} /> };
}

/**
 * Siparişler — TEK SATIR filtre çubuğu:
 * `[Ara][Görünüm][Termin][Müşteri][Sevk durumu][…][+ Filtre] … [Temizle][Kayıtlı][Sütunlar]`.
 * Süzme SUNUCUDA; çubuk yalnız URL yazar (liste · cursor · özet şeridi tek where).
 */
export function OrdersFilterRow(p: OrdersFilterRowProps) {
  const { filters, productionEnabled, showCancelled, setShowCancelled, forceFilters } = p;
  const { primary, more } = useMemo(() => {
    const date = filters.find((f): f is Extract<FilterDef, { kind: "dateRange" }> => f.kind === "dateRange");
    const keyed = filters.filter((f): f is Exclude<FilterDef, { kind: "dateRange" }> => f.kind !== "dateRange");
    const head: RowFilter[] = [
      { id: "nerede", label: "Görünüm", keys: [NEREDE_FILTER_KEY], render: ({ autoOpen }) => <OrdersViewSelect productionEnabled={productionEnabled} forceFilters={forceFilters} autoOpen={autoOpen} /> },
      ...(date ? [{ id: "date", label: date.label, keys: ["dateField", "dateFrom", "dateTo"], render: ({ autoOpen }: { autoOpen: boolean }) => <DatePresetFilter def={date} past={{ field: "deadline", label: "Termini geçmiş" }} autoOpen={autoOpen} /> }] : []),
      ...PRIMARY_KEYS.flatMap((k) => keyed.filter((d) => d.key === k).map((d) => defFilter(d, filters))),
    ];
    const tail: RowFilter[] = keyed.filter((d) => !PRIMARY_KEYS.includes(d.key)).map((d) => defFilter(d, filters));
    if (productionEnabled) {
      tail.push(
        { id: "fasonFirma", label: "Fason firma", keys: [FASON_FIRMA_KEY], render: ({ autoOpen }) => <FasonFirmaFilter autoOpen={autoOpen} /> },
        { id: "fasonGun", label: "Fasonda gün", keys: [FASON_GUN_KEY], render: ({ autoOpen }) => <FasonGunFilter autoOpen={autoOpen} /> },
      );
    }
    // Yerel anahtar (URL dışı): etkinken "İptaller dahil" kutusu, ✕ varsayılana (gizli) döndürür.
    tail.push({ id: "iptal", label: "İptaller dahil", keys: [], active: showCancelled, onAdd: () => setShowCancelled(true), onClear: () => setShowCancelled(false), render: () => <span className="px-2 text-xs">İptaller dahil</span> });
    return { primary: head, more: tail };
  }, [filters, productionEnabled, forceFilters, showCancelled, setShowCancelled]);

  return <FilterRow search={p.search} onSearchChange={p.onSearchChange} placeholder={p.placeholder} primary={primary} more={more} trailing={p.trailing} />;
}
