// Sorgu yardımcıları — imleçli listeler sunucuda süzülür (arayüz yalnız sayfaları birleştirir).
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { QueryValue } from "./api";
import { useApi } from "./session";
import type { Channel, Page } from "./types";

export function usePaged<T>(key: readonly unknown[], path: string, query: Readonly<Record<string, QueryValue>> = {}) {
  const api = useApi();
  const q = useInfiniteQuery({
    queryKey: [...key, query],
    queryFn: ({ pageParam }) => api.get<Page<T>>(path, { ...query, imlec: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  return {
    rows: q.data?.pages.flatMap((p) => p.items) ?? [],
    isLoading: q.isLoading,
    error: q.error,
    hasMore: q.hasNextPage,
    loadingMore: q.isFetchingNextPage,
    loadMore: () => void q.fetchNextPage(),
  };
}

export function useGet<T>(key: readonly unknown[], path: string, query?: Readonly<Record<string, QueryValue>>, enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: query ? [...key, query] : [...key], queryFn: () => api.get<T>(path, query), enabled });
}

/** Kanal kataloğu (satıcıda GET /kanallar): kurulum kanalı ve bayi tavanı yalnız kayıtlı kanaldan seçilir. */
export function useChannels(enabled = true): { readonly channels: readonly Channel[]; readonly isLoading: boolean; readonly error: unknown } {
  const q = useGet<Channel[]>(["kanallar"], "/kanallar", undefined, enabled);
  return { channels: q.data ?? [], isLoading: q.isLoading, error: q.error };
}
