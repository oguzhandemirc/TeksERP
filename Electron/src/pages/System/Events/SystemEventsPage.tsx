import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { RelocatedToolStrip } from "@/pages/Reports/_v2/RelocatedTools";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListSentinel } from "@/components/layout/ListPage";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { RefreshButton } from "@/components/RefreshButton";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLogListItem } from "@/types/systemLog";
import {
  SystemEventsFilters,
  type SystemEventsFilterState,
} from "./SystemEventsFilters";
import { SystemEventsList } from "./SystemEventsList";
import { SystemEventDetailSheet } from "./SystemEventDetailSheet";

const QUERY_KEY = "system-events";
const PAGE_SIZE = 50;

const INITIAL_FILTERS: SystemEventsFilterState = { category: "ALL" };

export function SystemEventsPage() {
  const [filters, setFilters] = useState<SystemEventsFilterState>(INITIAL_FILTERS);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Category filter "ALL" → AUTH+SYSTEM; aksi halde tek kategori.
  const categoryParam =
    filters.category === "ALL" ? "AUTH,SYSTEM" : filters.category;

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      systemLogService.list({
        category: categoryParam,
        action: filters.action,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
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

  // Perf: SystemEventsList'in React.memo'lu satırları için stabil referans.
  const handleSelect = useCallback((item: SystemLogListItem) => setDetailId(item.id), []);

  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: query.hasNextPage,
    isLoading: query.isFetchingNextPage,
    onLoadMore: () => void query.fetchNextPage(),
  });

  return (
    <PageShell>
      <PageHeader
        title="Sistem Kayıtları"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <RelocatedToolStrip host="/system/logs" />
      <SystemEventsFilters value={filters} onChange={setFilters} />

      <ListBody ref={rootRef}>
        <SystemEventsList items={items} loading={query.isLoading} onSelect={handleSelect} />
        {items.length > 0 && <ListSentinel ref={sentinelRef} />}
      </ListBody>
      <ListFooter loaded={items.length} hasMore={query.hasNextPage} isFetchingMore={query.isFetchingNextPage} />

      <SystemEventDetailSheet logId={detailId} onClose={() => setDetailId(null)} />
    </PageShell>
  );
}
