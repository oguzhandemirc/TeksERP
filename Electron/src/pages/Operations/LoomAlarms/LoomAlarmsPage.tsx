// =============================================================================
// ALARMLAR LİSTESİ — `/operations/loom-alarms` (tasarım §A.7 son paragraf)
// =============================================================================
// Aktif + geçmiş; süzgeç kapsam · kademe · hol · sebep · tarih. Liste, cursor ve özet şeridi
// sunucuda TEK where'den doğar — şerit ilk sayfanın cevabından okunur (cursor'dan bağımsız).
// Aktif kapsam 15 sn'de tazelenir. Kapı: route `loom:alarm-view` + `ROUTE_MODULE` (tezgah);
// bayrak kapalıysa sunucu 403 `LOOM_ALARM_DISABLED` → sayfa "kapalı" der.
// =============================================================================
import { useMemo, useState } from "react";
import { TERIM_AD } from "@/lib/terim";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AutoLoadMore } from "@/components/data-table/AutoLoadMore";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageBody, PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { isAlarmClosedError, useServerNow } from "./alarm-access";
import { AlarmClosedNotice } from "./AlarmClosedNotice";
import { INITIAL_ALARM_FILTERS, LoomAlarmsFilters, toListParams, type AlarmFilterState } from "./LoomAlarmsFilters";
import { AlarmSummaryStrip, LoomAlarmsTable } from "./LoomAlarmsTable";
import { loomAlarmService } from "./service";
import { LOOM_ALARMS_QUERY_ROOT } from "./useLoomAlarmActions";
import { useIsTabActive } from "@/components/layout/tabs/tab-active";

const PAGE_SIZE = 50;
const LIST_KEY = [LOOM_ALARMS_QUERY_ROOT, "list"];

function emptyText(scope: AlarmFilterState["scope"]): string {
  return scope === "active" ? "Şu an aktif alarm yok — bütün tezgahlar hedef süre içinde." : "Bu süzgeçte alarm yok.";
}

export function LoomAlarmsPage() {
  const [filters, setFilters] = useState<AlarmFilterState>(INITIAL_ALARM_FILTERS);
  const navigate = useNavigate();
  const now = useServerNow(15_000);
  const params = useMemo(() => toListParams(filters), [filters]);
  const tabActive = useIsTabActive();
  const q = useInfiniteQuery({
    queryKey: [...LIST_KEY, params],
    initialPageParam: undefined as string | undefined,
    // Sessiz: kapalı alarm 403'ü yetki sorunu değildir ("yetkiniz yok" toast'ı yanıltır) — sayfa durumu kendisi anlatır.
    queryFn: ({ pageParam }) => loomAlarmService.list({ ...params, cursor: pageParam, limit: PAGE_SIZE }, true),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Kapalı alarm 403'ü kalıcıdır — 15 sn'de bir aynı 403'ü sormak gürültüdür (ayar açılınca sayfa yenilenir).
    refetchInterval: (query) => (tabActive && filters.scope === "active" && !isAlarmClosedError(query.state.error) ? 15_000 : false),
    retry: false,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const summary = q.data?.pages[0]?.summary;
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: q.hasNextPage,
    isLoading: q.isFetchingNextPage,
    onLoadMore: () => void q.fetchNextPage(),
  });

  return (
    <PageShell>
      <PageHeader
        title={TERIM_AD.tezgahAlarmlari}
        description="Hedef süreyi aşan duruşlar: kim üstlendi, ne kadar sürdü, patrona iletildi mi"
        actions={<RefreshButton queryKey={LIST_KEY} />}
      />
      <div className="space-y-3 px-4 pb-3">
        <LoomAlarmsFilters value={filters} onChange={setFilters} />
        {summary && <AlarmSummaryStrip summary={summary} scope={filters.scope} />}
      </div>
      <PageBody ref={rootRef} className="px-4">
        {q.isError ? (
          isAlarmClosedError(q.error) ? (
            <AlarmClosedNotice error={q.error} />
          ) : (
            <p className="py-16 text-center text-muted-foreground">Alarmlar okunamadı — bağlantıyı kontrol edip yenileyin.</p>
          )
        ) : q.isPending ? (
          <p className="py-16 text-center text-muted-foreground">Yükleniyor…</p>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-muted-foreground">{emptyText(filters.scope)}</p>
        ) : (
          <>
            <LoomAlarmsTable items={items} now={now} onOpen={(id) => navigate(`/operations/loom-alarms/${id}`)} />
            <AutoLoadMore ref={sentinelRef} hasMore={q.hasNextPage} isFetchingMore={q.isFetchingNextPage} count={items.length} />
          </>
        )}
      </PageBody>
    </PageShell>
  );
}
