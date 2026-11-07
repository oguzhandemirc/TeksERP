import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { ViewSelect, type ViewOption } from "@/components/data-table/filter-row/ViewSelect";
import { persistConfigOf, splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import type { RowFilter } from "@/components/data-table/filter-row/row-filter";
import { customerService } from "@/pages/Customers/service";
import { returnReasonService } from "@/pages/ReturnReasons/service";

export const RETURN_FILTERS: FilterDef[] = [
  // ÇOKLU: ikisi de `ALLOWED_RETURN_FILTERS` → `buildWhereClause` yolundan geçer, RollReturn'de
  // skaler kolon → CSV `in` olur ("hangi nedenlerden iade geliyor" tek sorguda).
  { kind: "multi-lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  { kind: "multi-lookup", key: "reasonId", label: "Neden", service: returnReasonService, queryKey: "return-reasons" },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt" },
];

/** İptal durumu → `filter[cancelled]` (sunucu süzer); param yok = "Geçerli" (kayıt duruyor, mal iade rafında). */
export const CANCELLED_PARAM = "filter[cancelled]";
const STATUS_OPTIONS: readonly ViewOption[] = [
  { value: null, label: "Geçerli" },
  { value: "cancelled", label: "İptal edilen" },
  { value: "all", label: "Hepsi" },
];

export const RETURN_PERSIST = persistConfigOf(RETURN_FILTERS, { extraFilterKeys: [CANCELLED_PARAM] });

function ReturnsStatusSelect({ autoOpen }: { autoOpen?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get(CANCELLED_PARAM);
  const value = STATUS_OPTIONS.some((o) => o.value === raw) ? raw : null;
  const set = (v: string | null) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === null) next.delete(CANCELLED_PARAM);
        else next.set(CANCELLED_PARAM, v);
        next.delete("cursor");
        return next;
      },
      { replace: true },
    );
  return <ViewSelect label="Durum" options={STATUS_OPTIONS} value={value} onChange={set} autoOpen={autoOpen} />;
}

const STATUS_ROW_FILTER: RowFilter = { id: "cancelled", label: "Durum", keys: [CANCELLED_PARAM], render: ({ autoOpen }) => <ReturnsStatusSelect autoOpen={autoOpen} /> };

/** İade Takibi — TEK SATIR: `[Ara·Okut][Durum][Tarih][Müşteri][Neden] … [Temizle][Görünümler]`. */
export function ReturnsFilterRow({ leading, trailing }: { leading: ReactNode; trailing?: ReactNode }) {
  const split = splitDefFilters(RETURN_FILTERS, ["customerId", "reasonId"]);
  return <FilterRow leading={leading} primary={[STATUS_ROW_FILTER, ...split.primary]} more={split.more} trailing={trailing} />;
}
