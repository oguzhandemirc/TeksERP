import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell, PageBody } from "@/components/layout/PageShell";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { RefreshButton } from "@/components/RefreshButton";
import { ListExportMenu } from "@/components/data-table/ListExportMenu";
import type { ExportColumn } from "@/lib/list-export";
import { safeFormat } from "@/lib/format";
import { systemLogService } from "@/services/systemLogService";
import type { SystemLogListItem } from "@/types/systemLog";
import { ActivityFilters, type ActivityFilterState } from "./ActivityFilters";
import { ActivityFeed } from "./ActivityFeed";
import { ActivityDetailSheet } from "./ActivityDetailSheet";
import { actionLabel, tableLabel } from "./labels";

const QUERY_KEY = "system-logs";
const PAGE_SIZE = 50;

/** Akıştaki kullanıcı adı — kayıt sistem tarafından yazıldıysa "Sistem" (satırla aynı). */
const activityUser = (i: SystemLogListItem): string =>
  i.user ? i.user.fullName || i.user.username : "Sistem";

// Dışa aktarım sütunları — akış satırının düz tablo karşılığı. "Özet" satırda
// okunan cümlenin AYNISI (kullanıcı → modül → fiil); ekranda başka bir açıklama
// alanı yok (eski/yeni değerler yalnız detay panelinde).
const ACTIVITY_EXPORT_COLUMNS: ExportColumn<SystemLogListItem>[] = [
  { label: "Tarih / Saat", value: (i) => safeFormat(i.createdAt, "dd.MM.yyyy HH:mm:ss") },
  { label: "Kullanıcı", value: activityUser },
  { label: "İşlem", value: (i) => actionLabel(i.action) },
  { label: "Modül", value: (i) => tableLabel(i.tableName) },
  { label: "Tablo (teknik)", value: (i) => i.tableName },
  { label: "Kayıt", value: (i) => i.recordId },
  {
    label: "Özet",
    value: (i) => `${activityUser(i)} → ${tableLabel(i.tableName)} kaydını ${actionLabel(i.action)}`,
  },
];

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
        actions={
          <>
            <RefreshButton queryKey={QUERY_KEY} />
            <ListExportMenu
              name="Aktivite Günlüğü"
              rows={items}
              columns={ACTIVITY_EXPORT_COLUMNS}
              notes={[
                // ⚠️ Akış TEMBEL yüklenir (sonsuz kaydırma). Bunu yazmazsak indirilen
                // dosya "hepsi buymuş" gibi okunur — sessiz kırpma en tehlikeli hatadır.
                `Yalnız ekrana yüklenen ${items.length} kayıt — daha fazlası için "Daha fazla yükle" ile listeyi genişletin.`,
                "Filtreler (kullanıcı / modül / işlem / tarih) dosyaya birebir yansır.",
                "Eski/yeni değer dökümü dosyaya girmez — satırın detay panelinde görülür.",
              ]}
            />
          </>
        }
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
