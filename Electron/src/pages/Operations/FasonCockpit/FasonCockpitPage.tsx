// FASON KOKPİTİ (F10) — firmalar arası açık fason sevkleri: termin/gecikme, kısmi kabul sonrası kalan, iplik/levent
// bakiyesi. Liste + özet + firma şeridi TEK uçtan (`GET /api/subcontractor/cockpit`, aynı where); süzme sunucuda.
import { useMemo, useState } from "react";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/layout/PageShell";
import { ListBand, ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RefreshButton } from "@/components/RefreshButton";
import { FASON_COCKPIT_QUERY_KEY, listCockpit } from "./service";
import { CockpitFilters } from "./CockpitFilters";
import { CockpitFirmStrip, CockpitSummaryStrip } from "./CockpitSummary";
import { COCKPIT_COLUMNS, cockpitRowClass } from "./CockpitTable";
import type { CockpitFilter } from "./types";

export const FASON_COCKPIT_PATH = "/operations/fason-kokpiti";
export const FASON_COCKPIT_PERMISSIONS = ["subcontractor:read", "workorder:read"];
export const EMPTY_COCKPIT_FILTER: CockpitFilter = { state: "ALL", subcontractorId: null, categoryId: null };

export function FasonCockpitPage() {
  const [filter, setFilter] = useState<CockpitFilter>(EMPTY_COCKPIT_FILTER);
  const list = useInfiniteQuery({
    queryKey: [FASON_COCKPIT_QUERY_KEY, filter],
    queryFn: ({ pageParam }) => listCockpit(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Süzgeç değişirken eski özet/firma şeridi yerinde kalır (şerit zıplamasın, firma çipi kaybolmasın).
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const summary = list.data?.pages[0]?.summary ?? null;
  const table = useLocalTable({ tableKey: "fason:cockpit", data: items, columns: COCKPIT_COLUMNS, getRowId: (r) => r.dispatchId });

  return (
    <PageShell>
      <PageHeader
        title="Fason Kokpiti"
        description="Fasondaki bütün açık sevkler: ne zaman dönmeli, kaç gün gecikti, fasonda ne kaldı."
        actions={<RefreshButton queryKey={FASON_COCKPIT_QUERY_KEY} />}
      />
      <ListBand>
        <CockpitSummaryStrip summary={summary} />
      </ListBand>
      <ListToolbar>
        <CockpitFirmStrip summary={summary} selectedId={filter.subcontractorId} onSelect={(id) => setFilter({ ...filter, subcontractorId: id })} />
        <div className="flex flex-wrap items-center gap-2">
          <CockpitFilters filter={filter} onChange={setFilter} />
          <div className="ml-auto flex items-center gap-1.5">
            <DataTableTools table={table} compact exportName="Fason kokpiti" />
          </div>
        </div>
      </ListToolbar>
      {!list.isLoading && items.length > 0 ? (
        <DataTable
          table={table}
          isError={list.isError}
          onRetry={() => void list.refetch()}
          rowClassName={cockpitRowClass}
          loadMore={{ hasMore: Boolean(list.hasNextPage), isFetchingMore: list.isFetchingNextPage, onLoadMore: () => void list.fetchNextPage() }}
          exportName="Fason kokpiti"
        />
      ) : (
      <ListBody>
        {list.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : list.isError && items.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Liste yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “açık sevk yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>Tekrar dene</Button>
            </div>
          </ListMessage>
        ) : items.length === 0 ? (
          <ListMessage>
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Bu süzgece uyan açık fason sevki yok. Termin, sevkte girilir ya da firmanın/süreç türünün dönüş süresinden gelir.
            </div>
          </ListMessage>
        ) : null}
      </ListBody>
      )}
      <ListFooter loaded={items.length} total={summary?.openDispatchCount} hasMore={Boolean(list.hasNextPage)} isFetchingMore={list.isFetchingNextPage} />
    </PageShell>
  );
}
