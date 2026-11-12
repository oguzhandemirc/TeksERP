import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { RelocatedToolStrip } from "@/pages/Reports/_v2/RelocatedTools";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshButton } from "@/components/RefreshButton";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLogListItem } from "@/types/systemLog";
import {
  SystemEventsFilters,
  type SystemEventsFilterState,
} from "./SystemEventsFilters";
import { useSystemEventsTable } from "./SystemEventsList";
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

  const table = useSystemEventsTable(items);

  return (
    <PageShell>
      <PageHeader
        title="Sistem Kayıtları"
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <RelocatedToolStrip host="/system/logs" />
      <SystemEventsFilters
        value={filters}
        onChange={setFilters}
        tools={<DataTableTools table={table} compact exportName="Sistem kayıtları" />}
      />

      {items.length > 0 ? (
        <TooltipProvider delayDuration={300}>
          <DataTable
            table={table}
            onRowClick={(e) => setDetailId(e.id)}
            loadMore={{ hasMore: query.hasNextPage, isFetchingMore: query.isFetchingNextPage, onLoadMore: () => void query.fetchNextPage() }}
            exportName="Sistem kayıtları"
          />
        </TooltipProvider>
      ) : (
        <ListBody>
          {query.isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
              Filtreye uyan sistem kaydı bulunamadı.
            </div>
          )}
        </ListBody>
      )}
      <ListFooter loaded={items.length} hasMore={query.hasNextPage} isFetchingMore={query.isFetchingNextPage} />

      <SystemEventDetailSheet logId={detailId} onClose={() => setDetailId(null)} />
    </PageShell>
  );
}
