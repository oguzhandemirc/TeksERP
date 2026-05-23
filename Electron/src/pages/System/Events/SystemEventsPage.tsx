import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sistem Kayıtları"
        description="Kimlik doğrulama ve sistem olayları — login, başlatma, beklenmeyen hata."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <SystemEventsFilters value={filters} onChange={setFilters} />

      <div className="flex-1 overflow-auto">
        <SystemEventsList
          items={items}
          loading={query.isLoading}
          onSelect={(item) => setDetailId(item.id)}
        />

        {items.length > 0 && (
          <div className="flex justify-center p-6">
            <Button
              variant="outline"
              size="sm"
              disabled={!query.hasNextPage || query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
              className="gap-2"
            >
              {query.isFetchingNextPage ? (
                "Yükleniyor..."
              ) : query.hasNextPage ? (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Daha Fazla Yükle
                </>
              ) : (
                "Liste sonu"
              )}
            </Button>
          </div>
        )}
      </div>

      <SystemEventDetailSheet logId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
