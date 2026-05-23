import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Aktivite Günlüğü"
        description="Sistemde kim, ne zaman, hangi kaydı değiştirdi."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <ActivityFilters value={filters} onChange={setFilters} />

      <div className="flex-1 overflow-auto">
        <ActivityFeed
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

      <ActivityDetailSheet logId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
