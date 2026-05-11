import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";

// =============================================================================
// useCursorTable — büyük tablo için cursor pagination + react-table
// =============================================================================
// Offset pagination PostgreSQL'de offset>10K aşımında lineer yavaşlar.
// Cursor "son kayıttan sonrakini ver" mantığıyla sabit hız sağlar.
// "Daha Fazla Yükle" pattern; sayfa atlatma yok.
//
// Backend kontratı: GET /api/.../?mode=cursor&limit=50&cursor=<token>
// Yanıt: { data, pagination: { nextCursor, hasMore, limit, totalEstimate? } }
// =============================================================================

export interface CursorPage<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface CursorFetchParams {
  cursor?: string;
  limit: number;
  search?: string;
  filters: Record<string, string | string[]>;
}

interface Options<T> {
  queryKey: string;
  fetchFn: (params: CursorFetchParams) => Promise<CursorPage<T>>;
  columns: ColumnDef<T>[];
  defaultLimit?: number;
  /** Backend'e her durumda yollanan ek filtreler (URL'den override edilemez). */
  forceFilters?: Record<string, string | string[]>;
}

export function useCursorTable<T>({
  queryKey,
  fetchFn,
  columns,
  defaultLimit = 50,
  forceFilters,
}: Options<T>) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFiltersState] = useState<Record<string, string | string[]>>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [sorting, setSortingState] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const effectiveFilters = useMemo(
    () => ({ ...filters, ...(forceFilters ?? {}) }),
    [filters, forceFilters],
  );

  const queryFn = useCallback(
    async ({ pageParam }: { pageParam: string | null }) =>
      fetchFn({
        cursor: pageParam ?? undefined,
        limit: defaultLimit,
        search: debouncedSearch || undefined,
        filters: effectiveFilters,
      }),
    [fetchFn, defaultLimit, debouncedSearch, effectiveFilters],
  );

  const query = useInfiniteQuery({
    queryKey: [queryKey, "cursor", { search: debouncedSearch, filters: effectiveFilters }],
    queryFn,
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      last.pagination.hasMore ? last.pagination.nextCursor : undefined,
  });

  const flatData = useMemo<T[]>(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );
  const totalEstimate = query.data?.pages[0]?.pagination.totalEstimate;

  const table = useReactTable({
    data: flatData,
    columns,
    state: { sorting, rowSelection },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: true,
    onSortingChange: setSortingState,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
  });

  const setFilter = useCallback(
    (id: string, value: string | string[]) => {
      setFiltersState((prev) => {
        const next = { ...prev };
        if (!value || (Array.isArray(value) && value.length === 0)) {
          delete next[id];
        } else {
          next[id] = value;
        }
        return next;
      });
    },
    [],
  );

  const clearFilter = useCallback((id: string) => {
    setFiltersState((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFiltersState({});
    setSearchInput("");
  }, []);

  const selectedRows = useMemo(
    () => table.getSelectedRowModel().rows.map((r) => r.original),
    [table],
  );

  return {
    table,
    data: flatData,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage ?? false,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    isError: query.isError,

    totalEstimate,
    visibleCount: flatData.length,

    search: searchInput,
    setSearch: setSearchInput,
    activeFilters: filters,
    setFilter,
    clearFilter,
    clearAllFilters,

    rowSelection,
    selectedRows,
    selectedCount: selectedRows.length,
  };
}
