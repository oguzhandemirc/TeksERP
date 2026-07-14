import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLogListItem } from "@/types/systemLog";
import { ActivityFilters, type ActivityFilterState } from "../Activity/ActivityFilters";
import { ActivityFeed } from "../Activity/ActivityFeed";
import { ActivityDetailSheet } from "../Activity/ActivityDetailSheet";

const QUERY_KEY = "system-logs-archive";
const PAGE_SIZE = 50;

export function ArchiveSearchPage() {
  const [filters, setFilters] = useState<ActivityFilterState>({});
  const [detailId, setDetailId] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      systemLogService.listArchive({
        ...filters,
        category: "DOMAIN", // Arşiv Tarama da Activity Page'in arşiv görünümü
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Arşiv Tarama"
        description="Aktivite Günlüğü'nden arşive taşınmış eski kayıtlar. Burada çıkan veri aktif tabloda artık yok."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
      />
      <ActivityFilters value={filters} onChange={setFilters} />

      <div className="flex-1 overflow-auto">
        <ActivityFeed
          items={items}
          loading={query.isLoading}
          onSelect={handleSelect}
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

      <ActivityDetailSheet
        logId={detailId}
        onClose={() => setDetailId(null)}
        source="archive"
      />
    </div>
  );
}
