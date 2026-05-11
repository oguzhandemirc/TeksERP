import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { CursorPaginatedResponse, CursorParams } from "@/types/api";
import { parseUrlToQueryParams } from "@/lib/query-builder";

interface Options<T> {
  queryKey: string;
  fetchFn: (params: CursorParams) => Promise<CursorPaginatedResponse<T>>;
  columns: ColumnDef<T>[];
  /** Sayfa başına satır (cursor `limit`). Default 50. */
  defaultPageSize?: number;
  /** Backend'e her durumda yollanan ek filtreler (URL override edemez). */
  forceFilters?: Record<string, string | string[]>;
}

/**
 * Cursor pagination'lı tablo hook'u.
 * - URL state: `search`, `filter[*]`, `sortBy/sortOrder`, `pageSize`. Cursor URL'de YOK.
 * - İlk fetch'te `withTotal=true` → toplam tahmini gelir; sonraki sayfalar count atmaz.
 * - "Daha Fazla Yükle" tetiği: `loadMore()` + `hasMore` döner.
 * - Performans: derin offset hatası imkansız; tablo büyüse de sabit hız.
 */
export function useDataTable<T>({
  queryKey,
  fetchFn,
  columns,
  defaultPageSize = 50,
  forceFilters,
}: Options<T>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlParams = useMemo(
    () => parseUrlToQueryParams(searchParams.toString(), { pageSize: defaultPageSize }),
    [searchParams, defaultPageSize],
  );

  const filters = useMemo(
    () => ({ ...urlParams.filters, ...(forceFilters ?? {}) }),
    [urlParams.filters, forceFilters],
  );

  const [search, setSearchInput] = useState(urlParams.search ?? "");

  // Search debounce → URL'e yaz (cursor stack reset).
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (search) next.set("search", search);
      else next.delete("search");
      next.delete("page"); // legacy
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Stable cache key — filter/sort/search/date değişince refetch + cursor reset.
  const baseKey = useMemo(
    () => ({
      filters,
      search: urlParams.search,
      sortBy: urlParams.sortBy,
      sortOrder: urlParams.sortOrder,
      limit: urlParams.pageSize,
      dateField: urlParams.dateField,
      dateFrom: urlParams.dateFrom,
      dateTo: urlParams.dateTo,
    }),
    [
      filters,
      urlParams.search,
      urlParams.sortBy,
      urlParams.sortOrder,
      urlParams.pageSize,
      urlParams.dateField,
      urlParams.dateFrom,
      urlParams.dateTo,
    ],
  );

  const query = useInfiniteQuery({
    queryKey: [queryKey, baseKey],
    queryFn: ({ pageParam }) =>
      fetchFn({
        cursor: pageParam,
        limit: baseKey.limit,
        sortBy: baseKey.sortBy,
        sortOrder: baseKey.sortOrder,
        filters: baseKey.filters,
        search: baseKey.search,
        dateField: baseKey.dateField,
        dateFrom: baseKey.dateFrom,
        dateTo: baseKey.dateTo,
        // Total estimate yalnız ilk fetch'te.
        withTotal: pageParam === null,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.pagination.nextCursor,
    refetchOnMount: "always",
    staleTime: 0,
  });

  const flatRows = useMemo<T[]>(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );

  const totalEstimate = query.data?.pages[0]?.pagination.totalEstimate;

  const table = useReactTable({
    data: flatRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  return {
    table,
    query,
    search,
    setSearch: setSearchInput,
    pagination: {
      loaded: flatRows.length,
      total: totalEstimate,
      hasMore: query.hasNextPage,
      isFetchingMore: query.isFetchingNextPage,
      pageSize: baseKey.limit,
      loadMore: () => query.fetchNextPage(),
      setPageSize: (size: number) => {
        const next = new URLSearchParams(searchParams);
        next.set("pageSize", String(size));
        setSearchParams(next, { replace: true });
      },
    },
  };
}

export type DataTablePagination = ReturnType<typeof useDataTable>["pagination"];
