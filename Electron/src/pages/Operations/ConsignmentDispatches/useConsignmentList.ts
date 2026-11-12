// Emanet çıkış listesi: sunucu süzgeci + cursor (sonsuz kaydırma). Özet şeridi ilk sayfadan (liste ile aynı where).
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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
  const rows = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.data), [q.data]);
  return {
    rows,
    summary: q.data?.pages[0]?.summary,
    isLoading: q.isLoading,
    isError: q.isError,
    hasMore: Boolean(q.hasNextPage),
    isFetchingMore: q.isFetchingNextPage,
    refetch: () => void q.refetch(),
    /** Sonsuz kaydırma — dibi ortak tablo izler. */
    loadMore: () => void q.fetchNextPage(),
  };
}
