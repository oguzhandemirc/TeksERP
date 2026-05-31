import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { CursorPaginatedResponse, CursorParams } from "@/types/api";
import { parseUrlToQueryParams } from "@/lib/query-builder";
import { usePreferences } from "@/providers/PreferencesProvider";

interface Options<T> {
  queryKey: string;
  fetchFn: (params: CursorParams) => Promise<CursorPaginatedResponse<T>>;
  columns: ColumnDef<T>[];
  /** Sayfa başına satır (cursor `limit`). Default 50. */
  defaultPageSize?: number;
  /** Backend'e her durumda yollanan ek filtreler (URL override edemez). */
  forceFilters?: Record<string, string | string[]>;
  /** Satır seçimi (toplu işlem) — varsayılan açık. */
  enableSelection?: boolean;
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
  enableSelection = true,
}: Options<T>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const urlParams = useMemo(
    () => parseUrlToQueryParams(searchParams.toString(), { pageSize: defaultPageSize }),
    [searchParams, defaultPageSize],
  );

  const filters = useMemo(
    () => ({ ...urlParams.filters, ...(forceFilters ?? {}) }),
    [urlParams.filters, forceFilters],
  );

  const [search, setSearchInput] = useState(urlParams.search ?? "");
  // Debounce ile URL'e EN SON yazdığımız arama. Harici URL değişikliğini
  // (kayıtlı görünüm uygulama, tarayıcı geri/ileri) kendi yazımızdan ayırt
  // etmek için — aksi halde geri-senkron, kullanıcı yazarken input'u ezerdi.
  const lastPushedSearchRef = useRef(urlParams.search ?? "");

  // Sütun sırası + görünürlüğü — kullanıcı tercihlerinde (backend) saklanır,
  // cihazdan bağımsız. Boş = varsayılan.
  const { prefs, setPreference } = usePreferences();
  const columnOrder = useMemo(
    () => prefs.tableOrder?.[queryKey] ?? [],
    [prefs.tableOrder, queryKey],
  );
  const columnVisibility = useMemo<VisibilityState>(
    () => prefs.tableVisibility?.[queryKey] ?? {},
    [prefs.tableVisibility, queryKey],
  );
  const onColumnOrderChange: OnChangeFn<string[]> = (updater) => {
    const next = typeof updater === "function" ? updater(columnOrder) : updater;
    setPreference({ tableOrder: { ...(prefs.tableOrder ?? {}), [queryKey]: next } });
  };
  const onColumnVisibilityChange: OnChangeFn<VisibilityState> = (updater) => {
    const next = typeof updater === "function" ? updater(columnVisibility) : updater;
    setPreference({ tableVisibility: { ...(prefs.tableVisibility ?? {}), [queryKey]: next } });
  };

  // Search debounce → URL'e yaz (cursor stack reset).
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (search) next.set("search", search);
      else next.delete("search");
      next.delete("page"); // legacy
      lastPushedSearchRef.current = search;
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // URL → input geri-senkron: kayıtlı görünüm uygulandığında / tarayıcı
  // geri-ileri ile URL HARİCEN değiştiğinde arama kutusunu hizala. Kendi
  // debounce yazımız lastPushedSearchRef ile elenir → yazma akışı bozulmaz.
  useEffect(() => {
    const urlSearch = urlParams.search ?? "";
    if (urlSearch !== lastPushedSearchRef.current) {
      lastPushedSearchRef.current = urlSearch;
      setSearchInput(urlSearch);
    }
  }, [urlParams.search]);

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
    state: { columnOrder, columnVisibility, rowSelection },
    onColumnOrderChange,
    onColumnVisibilityChange,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: enableSelection,
    // Seçim entity id'sine bağlı — sayfa yüklendikçe index kaymasından etkilenmez.
    getRowId: (row) => (row as { id: string }).id,
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
