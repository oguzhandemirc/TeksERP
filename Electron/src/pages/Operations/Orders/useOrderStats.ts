import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { orderService } from "./service";

/**
 * Sipariş üst-satırındaki özet şeridinin sorgusu (`useRollStats` ikizi).
 *
 * Liste ile AYNI tabanı paylaşır: URL filtreleri + arama + tarih aralığı +
 * `forceFilters` (hideCancelled). Backend tarafında where zaten tek noktadan
 * (`BaseService.buildListWhere`) kuruluyor; buradaki eşitlik onun istemci
 * yarısıdır — biri değişip diğeri kalırsa şerit listeden sapar.
 *
 * `staleTime: 0` bilinçli: sayı bir karar verisi, bayatı gösterilmez. Sipariş
 * tablosu mütevazı ve sorgular indexli (`orders_active_createdAt_idx`).
 */
export function useOrderStats(forceFilters: Record<string, string>) {
  const [searchParams] = useSearchParams();
  // Sayfa boyutu VERİLMEZ: `/orders/stats` sayfalamaz (groupBy + aggregate),
  // buradan yalnız filtre/arama/tarih okunuyor. `useRollStats` ikizinde duran
  // `pageSize: 100` oraya picker bekçisinde gerekçeli bir muaf yazdırmıştı;
  // burada o parametrenin bir işi olmadığı için muafa da gerek yok.
  const urlParams = useMemo(() => parseUrlToQueryParams(searchParams.toString()), [searchParams]);
  const statsFilters = useMemo(
    () => ({ ...urlParams.filters, ...forceFilters }),
    [urlParams.filters, forceFilters],
  );
  return useQuery({
    queryKey: [
      "orders",
      "stats",
      statsFilters,
      urlParams.search,
      urlParams.dateField,
      urlParams.dateFrom,
      urlParams.dateTo,
    ],
    queryFn: () =>
      orderService.getStats({
        page: 1,
        pageSize: 1,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: statsFilters,
        search: urlParams.search,
        dateField: urlParams.dateField,
        dateFrom: urlParams.dateFrom,
        dateTo: urlParams.dateTo,
      }),
    staleTime: 0,
  });
}
