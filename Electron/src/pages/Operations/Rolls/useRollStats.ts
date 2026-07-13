import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { rollService, buildRollForceFilters, type RollStatusTabKey } from "./service";

/**
 * Envanter üst-satırındaki "Top/Metre" özeti için stats sorgusu. Liste tablosuyla
 * AYNI filtre tabanını (buildRollForceFilters + URL filtreleri + arama + tarih) ve
 * AYNI queryKey'i paylaşır → tek fetch + RefreshButton `["rolls"]` invalidate'i
 * ikisini birlikte tazeler. `tab=null` (KANBAN) iken sorgu kapalı.
 */
export function useRollStats(tab: RollStatusTabKey | null) {
  const [searchParams] = useSearchParams();
  const urlParams = useMemo(
    () => parseUrlToQueryParams(searchParams.toString(), { pageSize: 100 }),
    [searchParams],
  );
  const statsFilters = useMemo(
    () => ({ ...urlParams.filters, ...(tab ? buildRollForceFilters(tab) : {}) }),
    [urlParams.filters, tab],
  );
  return useQuery({
    queryKey: [
      "rolls",
      tab,
      "stats",
      statsFilters,
      urlParams.search,
      urlParams.dateField,
      urlParams.dateFrom,
      urlParams.dateTo,
    ],
    queryFn: () =>
      rollService.getStats({
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
    enabled: tab !== null,
    staleTime: 0,
  });
}
