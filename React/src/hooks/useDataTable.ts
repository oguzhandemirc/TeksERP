import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
  type ColumnSizingState,
} from "@tanstack/react-table";
import type { PaginatedResponse, QueryParams } from "@/types/api";
import { buildQueryString, parseUrlToQueryParams } from "@/lib/query-builder";
import type { DateRange } from "@/components/data-table/DataTableDateRangeFilter";

interface UseDataTableOptions<TData> {
  queryKey: string | string[];
  fetchFn: (params: QueryParams) => Promise<PaginatedResponse<TData>>;
  columns: ColumnDef<TData, unknown>[];
  defaultPageSize?: number;
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
  queryOptions?: Omit<
    UseQueryOptions<PaginatedResponse<TData>>,
    "queryKey" | "queryFn"
  >;
}

export function useDataTable<TData>({
  queryKey,
  fetchFn,
  columns,
  defaultPageSize = 20,
  defaultSortBy = "createdAt",
  defaultSortOrder = "desc",
  queryOptions,
}: UseDataTableOptions<TData>) {
  const [searchParams, setSearchParams] = useSearchParams();

  const queryParams = useMemo(
    () =>
      parseUrlToQueryParams(searchParams.toString(), {
        page: 1,
        pageSize: defaultPageSize,
        sortBy: defaultSortBy,
        sortOrder: defaultSortOrder,
      }),
    [searchParams, defaultPageSize, defaultSortBy, defaultSortOrder],
  );

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [dateRange, setDateRange] = useState<DateRange | null>(null);

  const updateUrl = useCallback(
    (updates: Partial<QueryParams>) => {
      const merged = { ...queryParams, ...updates };
      if (updates.search !== undefined || updates.filters) {
        merged.page = 1;
      }
      const qs = buildQueryString(merged);
      setSearchParams(qs ? qs.slice(1) : "", { replace: true });
    },
    [queryParams, setSearchParams],
  );

  const effectiveParams = useMemo(() => {
    const params = { ...queryParams };
    if (dateRange?.from) {
      params.filters = { ...params.filters, dateFrom: dateRange.from };
    }
    if (dateRange?.to) {
      params.filters = { ...params.filters, dateTo: dateRange.to };
    }
    return params;
  }, [queryParams, dateRange]);

  const { data, isLoading, isFetching, isError, refetch } = useQuery<
    PaginatedResponse<TData>
  >({
    queryKey: Array.isArray(queryKey) ? [...queryKey, effectiveParams] : [queryKey, effectiveParams],
    queryFn: () => fetchFn(effectiveParams),
    placeholderData: (prev, prevQuery) => {
      const prevParams = prevQuery?.queryKey?.[prevQuery.queryKey.length - 1] as
        | QueryParams
        | undefined;
      if (!prevParams) return prev;
      const onlyPaginationChanged =
        prevParams.search === effectiveParams.search &&
        prevParams.sortBy === effectiveParams.sortBy &&
        prevParams.sortOrder === effectiveParams.sortOrder &&
        JSON.stringify(prevParams.filters) === JSON.stringify(effectiveParams.filters);
      return onlyPaginationChanged ? prev : undefined;
    },
    ...queryOptions,
  });

  const sorting: SortingState = useMemo(
    () => [{ id: queryParams.sortBy, desc: queryParams.sortOrder === "desc" }],
    [queryParams.sortBy, queryParams.sortOrder],
  );

  const table = useReactTable({
    data: data?.data ?? [],
    columns,
    state: {
      sorting,
      rowSelection,
      columnSizing,
    },
    pageCount: data?.pagination?.totalPages ?? -1,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    enableRowSelection: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    onSortingChange: (updater) => {
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      if (newSorting.length > 0) {
        updateUrl({
          sortBy: newSorting[0].id,
          sortOrder: newSorting[0].desc ? "desc" : "asc",
        });
      }
    },
    onRowSelectionChange: setRowSelection,
    onColumnSizingChange: setColumnSizing,
    getCoreRowModel: getCoreRowModel(),
  });

  const setPage = useCallback(
    (page: number) => updateUrl({ page }),
    [updateUrl],
  );

  const setPageSize = useCallback(
    (pageSize: number) => updateUrl({ pageSize, page: 1 }),
    [updateUrl],
  );

  const setSearch = useCallback(
    (search: string) => updateUrl({ search: search || undefined }),
    [updateUrl],
  );

  const setFilter = useCallback(
    (id: string, value: string | string[]) => {
      const newFilters = { ...queryParams.filters };
      if (!value || (Array.isArray(value) && value.length === 0)) {
        delete newFilters[id];
      } else {
        newFilters[id] = value;
      }
      updateUrl({ filters: newFilters });
    },
    [queryParams.filters, updateUrl],
  );

  const clearFilter = useCallback(
    (id: string) => {
      const newFilters = { ...queryParams.filters };
      delete newFilters[id];
      updateUrl({ filters: newFilters });
    },
    [queryParams.filters, updateUrl],
  );

  const clearAllFilters = useCallback(() => {
    updateUrl({ filters: {}, search: undefined });
    setDateRange(null);
  }, [updateUrl]);

  const selectedRows = useMemo(
    () =>
      table
        .getSelectedRowModel()
        .rows.map((r) => r.original),
    [table],
  );

  return {
    table,
    data: data?.data ?? [],
    pagination: data?.pagination ?? { page: 1, pageSize: defaultPageSize, total: 0, totalPages: 0 },
    isLoading,
    isFetching,
    isError,
    refetch,

    search: queryParams.search ?? "",
    setSearch,
    activeFilters: queryParams.filters,
    setFilter,
    clearFilter,
    clearAllFilters,

    page: queryParams.page,
    pageSize: queryParams.pageSize,
    setPage,
    setPageSize,

    dateRange,
    setDateRange,

    rowSelection,
    selectedRows,
    selectedCount: selectedRows.length,
  };
}
