import { useMemo, type ReactNode } from "react";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { dateRowFilter, defRowFilter, localToggleRowFilter, urlToggleRowFilter } from "@/components/data-table/filter-row/def-row-filters";
import type { RowFilter } from "@/components/data-table/filter-row/row-filter";
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
  /** "İptaller dahil" URL'de duruyorsa anahtarı — ✕/Temizle onu da TEK URL yazımıyla siler. */
  cancelledUrlKey?: string;
  trailing?: ReactNode;
}

/**
 * Siparişler — TEK SATIR filtre çubuğu:
 * `[Ara][Görünüm][Termin][Müşteri][Sevk durumu][…][+ Filtre] … [Temizle][Kayıtlı][Sütunlar]`.
 * Süzme SUNUCUDA; çubuk yalnız URL yazar (liste · cursor · özet şeridi tek where).
 */
export function OrdersFilterRow(p: OrdersFilterRowProps) {
  const { filters, productionEnabled, showCancelled, setShowCancelled, forceFilters, cancelledUrlKey } = p;
  const { primary, more } = useMemo(() => {
    const date = filters.find((f): f is Extract<FilterDef, { kind: "dateRange" }> => f.kind === "dateRange");
    const keyed = filters.filter((f): f is Exclude<FilterDef, { kind: "dateRange" }> => f.kind !== "dateRange");
    const head: RowFilter[] = [
      { id: "nerede", label: "Görünüm", keys: [NEREDE_FILTER_KEY], render: ({ autoOpen }) => <OrdersViewSelect productionEnabled={productionEnabled} forceFilters={forceFilters} autoOpen={autoOpen} /> },
      ...(date ? [dateRowFilter(date, { field: "deadline", label: "Termini geçmiş" })] : []),
      ...PRIMARY_KEYS.flatMap((k) => keyed.filter((d) => d.key === k).map((d) => defRowFilter(d, filters))),
    ];
    const tail: RowFilter[] = keyed.filter((d) => !PRIMARY_KEYS.includes(d.key)).map((d) => defRowFilter(d, filters));
    if (productionEnabled) {
      tail.push(
        { id: "fasonFirma", label: "Fason firma", keys: [FASON_FIRMA_KEY], render: ({ autoOpen }) => <FasonFirmaFilter autoOpen={autoOpen} /> },
        { id: "fasonGun", label: "Fasonda gün", keys: [FASON_GUN_KEY], render: ({ autoOpen }) => <FasonGunFilter autoOpen={autoOpen} /> },
      );
    }
    // Etkinken "İptaller dahil" kutusu, ✕ varsayılana (gizli) döndürür. URL'deyse ✕/Temizle anahtarı siler.
    tail.push(cancelledUrlKey ? urlToggleRowFilter("iptal", "İptaller dahil", cancelledUrlKey, setShowCancelled) : localToggleRowFilter("iptal", "İptaller dahil", showCancelled, setShowCancelled));
    return { primary: head, more: tail };
  }, [filters, productionEnabled, forceFilters, showCancelled, setShowCancelled, cancelledUrlKey]);

  return <FilterRow search={p.search} onSearchChange={p.onSearchChange} placeholder={p.placeholder} primary={primary} more={more} trailing={p.trailing} />;
}
