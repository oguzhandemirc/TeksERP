import { useMemo, type ReactNode } from "react";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import { ACCOUNTING_FILTERS, ACCOUNTING_PRIMARY_KEYS } from "./filters";

/** Sevk Edilenler — TEK SATIR: `[Ara][Sevk Tarihi][Müşteri][Fatura][Yön][+ Filtre] … [Temizle][Görünümler][Sütunlar][Dışa aktar]`. */
export function AccountingFilterRow({ search, onSearchChange, trailing }: { search: string; onSearchChange: (v: string) => void; trailing?: ReactNode }) {
  const split = useMemo(() => splitDefFilters(ACCOUNTING_FILTERS, ACCOUNTING_PRIMARY_KEYS), []);
  return (
    <FilterRow
      search={search}
      onSearchChange={onSearchChange}
      placeholder="Sevkiyat no, sipariş no, firma, plaka, sürücü ara..."
      primary={split.primary}
      more={split.more}
      trailing={trailing}
    />
  );
}
