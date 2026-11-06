import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { orderService } from "./service";
import type { NeredeTab } from "./order-nerede";

/**
 * "Görünüm" seçeneklerinin sayısı — FACETED: liste tabanı AYNEN (URL süzgeçleri + arama
 * + tarih + `forceFilters`), yalnız kendi anahtarı (`nerede`) seçenekle değiştirilir;
 * sayı = o seçenek seçilince listenin toplamı. Mevcut `/orders/stats` ucu (tek where),
 * yeni uç YOK. Sorgu anahtarı `useOrderStats` ile aynı biçimde → etkin seçenek önbellekten.
 * Yalnız açılır liste AÇIKKEN istenir.
 */
export function useOrderViewCounts(tabs: readonly NeredeTab[], forceFilters: Record<string, string>, enabled: boolean) {
  const [sp] = useSearchParams();
  const base = useMemo(() => {
    const u = parseUrlToQueryParams(sp.toString());
    const filters: Record<string, string | string[]> = { ...u.filters, ...forceFilters };
    delete filters.nerede;
    return { ...u, filters };
  }, [sp, forceFilters]);
  const results = useQueries({
    queries: tabs.map((t) => {
      const filters = t.value ? { ...base.filters, nerede: t.value } : base.filters;
      return {
        queryKey: ["orders", "stats", filters, base.search, base.dateField, base.dateFrom, base.dateTo],
        queryFn: () =>
          orderService.getStats({
            page: 1,
            pageSize: 1,
            sortBy: "createdAt",
            sortOrder: "desc" as const,
            filters,
            search: base.search,
            dateField: base.dateField,
            dateFrom: base.dateFrom,
            dateTo: base.dateTo,
          }),
        enabled,
        staleTime: 30_000,
      };
    }),
  });
  return useMemo(
    () => new Map<string | null, number | null | undefined>(tabs.map((t, i) => [t.value, results[i]?.isError ? null : results[i]?.data?.data?.totalCount])),
    [tabs, results],
  );
}
