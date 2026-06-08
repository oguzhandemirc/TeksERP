import { useInfiniteQuery } from "@tanstack/react-query";
import type { CrudService } from "@/services/crudService";

const PAGE_LIMIT = 50;

interface Args<T> {
  open: boolean;
  service: CrudService<T>;
  queryKey: string;
  debouncedSearch: string;
  /** `isActive: "true"` üstüne eklenir. Örn: { allowAsWorkOrderStep: "true" }. */
  filters?: Record<string, string>;
  sortBy?: string;
}

/**
 * Genel arama-modalı veri katmanı: sunucu cursor araması (debounced) + sonsuz
 * kaydırma ("Daha fazla"). Yüzlerce/binlerce kayıt için ölçeklenir — OFFSET yok,
 * her sayfa son cursor'dan devam eder; arama backend'de yapılır (ad/kod).
 * Renk picker'ındaki [[useColorPickerData]] ile aynı strateji, müşteri
 * afinitesi olmadan.
 */
export function useEntityPickerData<T extends { id: string }>({
  open,
  service,
  queryKey,
  debouncedSearch,
  filters,
  sortBy = "name",
}: Args<T>) {
  const q = debouncedSearch.trim();

  const listQ = useInfiniteQuery({
    queryKey: [queryKey, "entity-picker", q, filters ?? null],
    queryFn: ({ pageParam }) =>
      service.listCursor({
        cursor: pageParam,
        limit: PAGE_LIMIT,
        sortBy,
        sortOrder: "asc",
        filters: { isActive: "true", ...filters },
        ...(q ? { search: q } : {}),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
    enabled: open,
    staleTime: 30_000,
  });

  const items = (listQ.data?.pages ?? []).flatMap((p) => p.data);

  return {
    items,
    isLoading: listQ.isLoading,
    hasMore: Boolean(listQ.hasNextPage),
    fetchNext: () => listQ.fetchNextPage(),
    isFetchingNext: listQ.isFetchingNextPage,
  };
}
