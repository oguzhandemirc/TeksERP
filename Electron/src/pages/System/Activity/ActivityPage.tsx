import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { RelocatedToolStrip } from "@/pages/Reports/_v2/RelocatedTools";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { RefreshButton } from "@/components/RefreshButton";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import { Callout } from "@/components/ui/callout";
import { systemLogService } from "@/services/systemLogService";
import { useActivityTraceSeed } from "./useActivityTraceSeed";
import { ActivityFilters } from "./ActivityFilters";
import { ActivityFeed } from "./ActivityFeed";
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import {
  ACTIVITY_EXPORT_COLUMNS,
  buildFeedParams,
  effectiveView,
  emptyFeedText,
  isIslemItem,
  type ActivityFilterState,
  type FeedItem,
} from "./activity-view";

const QUERY_KEY = "system-logs";
const PAGE_SIZE = 50;

type Selected = { logId: string } | { requestId: string } | null;

const exportNotes = (n: number): string[] => [
  // ⚠️ Akış TEMBEL yüklenir (sonsuz kaydırma). Bunu yazmazsak indirilen
  // dosya "hepsi buymuş" gibi okunur — sessiz kırpma en tehlikeli hatadır.
  `Yalnız ekrana yüklenen ${n} kayıt — daha fazlası için listeyi aşağı kaydırarak genişletin.`,
  "Süzgeçler (görünüm / gün / kişi / arama / modül / tarih) dosyaya birebir yansır.",
  "Açıklama, sunucunun okuma anında kurduğu cümledir; eski/yeni değer dökümü satırın ayrıntısında görülür.",
];

export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilterState>({ gorunum: "islem" });
  const [selected, setSelected] = useState<Selected>(null);
  const seedRev = useActivityTraceSeed(setFilters);

  const query = useInfiniteQuery({
    queryKey: [QUERY_KEY, "feed", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => systemLogService.feed(buildFeedParams(filters, pageParam, PAGE_SIZE)),
    // `q` araması sayfalanmaz (yanıtında pagination yok).
    getNextPageParam: (last) => last.pagination?.nextCursor ?? undefined,
    staleTime: 30_000,
  });

  const items = useMemo<FeedItem[]>(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const warnings = query.data?.pages[0]?.warnings ?? [];
  // Eski backend `reddedilen`i yok sayar: işaret görülene dek çip gizli; bir kez görülünce
  // kalır (çipe basınca yeniden yüklenirken kaybolmasın). Render sırasında güncelleme React kalıbı.
  const [rejectedSupported, setRejectedSupported] = useState(false);
  if (!rejectedSupported && query.data?.pages[0]?.reddedilenSuzgeci === true) setRejectedSupported(true);
  const requested = filters.gorunum ?? "islem";
  const view = effectiveView(requested, items);
  // İşlem görünümü istendi, sunucu satır döndürdü ve arama yok → eski backend.
  const fellBack = requested === "islem" && view === "satir" && !filters.q;

  // Perf: ActivityFeed'in React.memo'lu satırları için stabil referans.
  const handleSelect = useCallback((item: FeedItem) => {
    if (isIslemItem(item)) {
      setSelected(item.requestId ? { requestId: item.requestId } : { logId: item.satirlar[0]?.id ?? item.id });
    } else {
      setSelected({ logId: item.id });
    }
  }, []);

  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: query.hasNextPage,
    isLoading: query.isFetchingNextPage,
    onLoadMore: () => void query.fetchNextPage(),
  });

  return (
    <PageShell>
      <PageHeader
        title="Etkinlik"
        description="Kim ne yaptı — günlük dille işlemler; ayrıntıda teknik iz"
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <ListExportMenu
              name="Etkinlik"
              rows={items}
              columns={ACTIVITY_EXPORT_COLUMNS}
              notes={exportNotes(items.length)}
            />
          </>
        }
      />
      <RelocatedToolStrip host="/system/activity" />
      <ActivityFilters key={seedRev} value={filters} onChange={setFilters} rejectedAvailable={rejectedSupported} />

      <PageBody ref={rootRef}>
        {fellBack && items.length > 0 && (
          <div className="px-4 pt-3 sm:px-6">
            <Callout tone="info">
              Sunucu sürümü işlem görünümünü desteklemiyor — tüm satırlar gösteriliyor.
            </Callout>
          </div>
        )}
        <ActivityFeed
          items={items}
          loading={query.isLoading}
          onSelect={handleSelect}
          emptyText={emptyFeedText(filters, warnings)}
        />
        {items.length > 0 && !filters.q && (
          <AutoLoadMore
            ref={sentinelRef}
            hasMore={query.hasNextPage}
            isFetchingMore={query.isFetchingNextPage}
            count={items.length}
          />
        )}
      </PageBody>

      <ActivityDetailSheet
        logId={selected && "logId" in selected ? selected.logId : null}
        requestId={selected && "requestId" in selected ? selected.requestId : null}
        onClose={() => setSelected(null)}
      />
    </PageShell>
  );
}
