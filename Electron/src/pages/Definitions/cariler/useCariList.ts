// Cariler — liste sorgusu: iki kaynak (müşteri kartı + BAĞSIZ eski fason profili) AYNI sayfayı sunucudan
// çeker; arama ve rol süzgeci SUNUCUDA (`cariQueryPlan`). Önceki sayfa gövdesinden taşındı, davranış aynı.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UNLINKED_SUBCONTRACTOR_FILTER } from "@/components/forms/supplierPicker";
import { customerService } from "@/pages/Customers/service";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { cariPageInfo, cariQueryPlan, mergeCariRows, type CariFilters } from "../carilerPaging";
import { customerRow, subcontractorRow, type CariRowItem } from "./cari-row";

/** Sayfa başına kart — iki kaynak da AYNI sayfayı çeker (bkz. `carilerPaging`). */
export const CARI_PAGE_SIZE = 50;
/** Arama her tuşta istek atmasın. */
const SEARCH_DEBOUNCE_MS = 300;

export function useDebounced(value: string): string {
  const [v, setV] = useState(value.trim());
  useEffect(() => {
    const t = setTimeout(() => setV(value.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);
  return v;
}

export function useCariList(search: string, filters: CariFilters, filtersReady: boolean) {
  const debouncedSearch = useDebounced(search);
  const [page, setPage] = useState(1);
  // Süzgeç değişince SAYFA BAŞA: 7. sayfada arama yazan, 3 sonuçlu kümenin boş 7. sayfasını görmesin.
  useEffect(() => setPage(1), [debouncedSearch, filters]);
  const plan = cariQueryPlan(filters);

  // filters: {} → pasifler DAHİL (yönetim görünümü pasif kartı da bulabilmeli).
  const customersQ = useQuery({
    queryKey: ["customers", "cariler", page, debouncedSearch, plan.customerFilters],
    queryFn: () =>
      customerService.getAll({ page, pageSize: CARI_PAGE_SIZE, sortBy: "name", sortOrder: "asc", search: debouncedSearch || undefined, filters: { ...plan.customerFilters } }),
    enabled: plan.customers && filtersReady,
  });
  const subsQ = useQuery({
    queryKey: ["subcontractors", "cariler", page, debouncedSearch],
    queryFn: () =>
      subcontractorService.getAll({ page, pageSize: CARI_PAGE_SIZE, sortBy: "name", sortOrder: "asc", search: debouncedSearch || undefined, filters: { ...UNLINKED_SUBCONTRACTOR_FILTER } }),
    enabled: plan.subcontractors && filtersReady,
  });

  const rows = useMemo<CariRowItem[]>(() => {
    const cs = plan.customers ? (customersQ.data?.data ?? []).map(customerRow) : [];
    const ss = plan.subcontractors ? (subsQ.data?.data ?? []).map(subcontractorRow) : [];
    return mergeCariRows(cs, ss);
  }, [customersQ.data, subsQ.data, plan.customers, plan.subcontractors]);

  const pageInfo = cariPageInfo({
    page,
    pageSize: CARI_PAGE_SIZE,
    customerTotal: customersQ.data?.pagination?.total ?? 0,
    subTotal: subsQ.data?.pagination?.total ?? 0,
    plan,
  });
  // ⚠️ HATA "KAYIT YOK" DEĞİLDİR: tek kaynak düşse bile liste EKSİKTİR — kullanıcı eksik cariyi "yok"
  // sanıp MÜKERRER KART açar (ticaret rejiminde cari kartının tek giriş kapısı bu ekran).
  const isError = (plan.customers && customersQ.isError) || (plan.subcontractors && subsQ.isError);
  const loading = !filtersReady || (plan.customers && customersQ.isLoading) || (plan.subcontractors && subsQ.isLoading);
  const error = customersQ.error ?? subsQ.error;
  const retry = () => {
    if (plan.customers) void customersQ.refetch();
    if (plan.subcontractors) void subsQ.refetch();
  };
  return { rows, page, setPage, pageInfo, isError, loading, error, retry, debouncedSearch };
}
