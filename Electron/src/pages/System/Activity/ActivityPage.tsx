import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { RefreshButton } from "@/components/RefreshButton";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLogListItem } from "@/types/systemLog";
import { ActivityFilters, type ActivityFilterState } from "./ActivityFilters";
import { ActivityFeed } from "./ActivityFeed";
import { ActivityDetailSheet } from "./ActivityDetailSheet";

const QUERY_KEY = "system-logs";
const PAGE_SIZE = 50;

export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilterState>({});
  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      systemLogService.list({
        ...filters,
        category: "DOMAIN", // AUTH/SYSTEM event'leri Sistem Kayıtları sayfasında
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last) => last.pagination.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const items = useMemo<SystemLogListItem[]>(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );

  // Perf: ActivityFeed'in React.memo'lu satırları için stabil referans.
  const handleSelect = useCallback((item: SystemLogListItem) => setDetailId(item.id), []);

  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: query.hasNextPage,
    isLoading: query.isFetchingNextPage,
    onLoadMore: () => void query.fetchNextPage(),
  });

  return (
    <PageShell>
      <PageHeader
        title="Aktivite Günlüğü"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <ActivityFilters value={filters} onChange={setFilters} />

      <PageBody ref={rootRef}>
        <ActivityFeed items={items} loading={query.isLoading} onSelect={handleSelect} />
        {items.length > 0 && (
          <AutoLoadMore
            ref={sentinelRef}
            hasMore={query.hasNextPage}
            isFetchingMore={query.isFetchingNextPage}
            count={items.length}
          />
        )}
      </PageBody>

      <ActivityDetailSheet logId={detailId} onClose={() => setDetailId(null)} />
    </PageShell>
  );
}
