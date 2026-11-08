// Emanet çıkış listesi: sunucu süzgeci + cursor (sonsuz kaydırma). Özet şeridi ilk sayfadan (liste ile aynı where).
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { CONSIGNMENT_DISPATCHES_QUERY_KEY, listConsignmentDispatches } from "./service";
import type { ConsignmentDispatchListFilter } from "./types";

const PAGE = 50;

export function useConsignmentList(f: ConsignmentDispatchListFilter) {
  const query = { ...f, search: useDebouncedValue(f.search) };
  const q = useInfiniteQuery({
    queryKey: [CONSIGNMENT_DISPATCHES_QUERY_KEY, "list", query],
    queryFn: ({ pageParam }) => listConsignmentDispatches(query, pageParam, PAGE),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const scroll = useInfiniteScroll({ hasMore: Boolean(q.hasNextPage), isLoading: q.isFetchingNextPage, onLoadMore: () => void q.fetchNextPage() });
  return {
    rows: (q.data?.pages ?? []).flatMap((p) => p.data),
    summary: q.data?.pages[0]?.summary,
    isLoading: q.isLoading,
    isError: q.isError,
    hasMore: Boolean(q.hasNextPage),
    isFetchingMore: q.isFetchingNextPage,
    refetch: () => void q.refetch(),
    ...scroll,
  };
}
