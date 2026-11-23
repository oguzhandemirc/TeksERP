// SEVKE HAZIR İŞLER (D4-J3, ister 2.4 / 2.10) — iş emri / gelen belge / parti / müşteri başına sevke hazırlık.
// Sekme = `groupBy`; durum süzgeci query'de (liste + imleç + özet şeridi sunucuda aynı where'den). Satır → toplar
// çekmecesi; "sevke al" mevcut Hızlı Sevk boğazı. Gelen belge modülü kapalıyken iki sekme yok, istek de yok.
import { useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import { ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { RefreshButton } from "@/components/RefreshButton";
import { useFeatureFlags, useGelenBelgeEnabled } from "@/hooks/usePricingEnabled";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { TERIM } from "@/lib/terim";
import { QuickShipDialog } from "@/pages/Operations/Rolls/QuickShipDialog";
import { ShipmentDocDialog } from "@/pages/Operations/Shipments/ShipmentDocDialog";
import type { QuickShipRoll } from "@/pages/Operations/Rolls/quickShipService";
import { getReadyWorks, READY_WORKS_QUERY_KEY, type ReadyWorkRow, type ReadyWorkUnit } from "./service";
import { readyWorksTabs, statesForFilter, toQuickShipRoll, type ReadyStateFilter } from "./ready-works-view";
import { ReadyWorkRollsSheet } from "./ReadyWorkRollsSheet";
import { ReadyWorksToolbar, SummaryStrip } from "./ReadyWorksTable";
import { readyWorksColumns } from "./readyWorksColumns";

const PAGE = 50;

/** Toplar çekmecesi → mevcut Hızlı Sevk diyaloğu → irsaliye kestirmesi (Kumaş Stoğu ile aynı zincir). */
function ShipFlow({ openRow, onCloseRow, canShip }: { openRow: ReadyWorkRow | null; onCloseRow: () => void; canShip: boolean }) {
  const qc = useQueryClient();
  const [ship, setShip] = useState<{ rolls: QuickShipRoll[]; customerId: string | null } | null>(null);
  const [shippedId, setShippedId] = useState<string | null>(null);
  return (
    <>
      {openRow && (
        <ReadyWorkRollsSheet
          row={openRow}
          canShip={canShip}
          onClose={onCloseRow}
          onShip={(rolls, customerId) => {
            setShip({ rolls: rolls.map(toQuickShipRoll), customerId });
            onCloseRow();
          }}
        />
      )}
      {ship && (
        <QuickShipDialog
          open
          onOpenChange={(o) => !o && setShip(null)}
          initialRolls={ship.rolls}
          initialCustomerId={ship.customerId}
          onShipped={(id) => {
            void qc.invalidateQueries({ queryKey: [READY_WORKS_QUERY_KEY] });
            setShippedId(id);
          }}
        />
      )}
      <ShipmentDocDialog shipmentId={shippedId} open={Boolean(shippedId)} onOpenChange={(o) => !o && setShippedId(null)} />
    </>
  );
}

export function ReadyWorksPage() {
  const incomingDocEnabled = useGelenBelgeEnabled();
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const { hasPermission } = useRoleAccess();
  const canShip = financeEnabled && hasPermission("shipping:write");

  const tabs = readyWorksTabs(incomingDocEnabled);
  // `?tab=customer` — İçerideki İşler hazırlık hücresi Müşteri sekmesini açar; tanınmayan değer varsayılana, gizli sekme aşağıdaki görünür-küme düşüşüne düşer.
  const [searchParams] = useSearchParams();
  const [picked, setPicked] = useState<ReadyWorkUnit>(() => {
    const t = searchParams.get("tab");
    return readyWorksTabs(true).some((x) => x.unit === t) ? (t as ReadyWorkUnit) : "workOrder";
  });
  // Modül kapanırsa (ya da bayrak geç gelirse) seçili sekme görünür kümeye düşer — gizli birime istek gitmez.
  const unit: ReadyWorkUnit = tabs.some((t) => t.unit === picked) ? picked : "workOrder";
  const [stateFilter, setStateFilter] = useState<ReadyStateFilter>("READY");
  const states = statesForFilter(stateFilter);

  const q = useInfiniteQuery({
    queryKey: [READY_WORKS_QUERY_KEY, "list", unit, states.join(",")],
    queryFn: ({ pageParam }) => getReadyWorks({ groupBy: unit, states, cursor: pageParam, limit: PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = (q.data?.pages ?? []).flatMap((p) => p.items);
  const first = q.data?.pages[0];

  const [openRow, setOpenRow] = useState<ReadyWorkRow | null>(null);
  const unitLabel = tabs.find((t) => t.unit === unit)?.label ?? "İş";
  const columns = useMemo(() => readyWorksColumns(unitLabel, unit === "customer"), [unitLabel, unit]);
  const table = useLocalTable({
    tableKey: "ready-works",
    data: rows,
    columns,
    getRowId: (r) => `${r.unit}:${r.id}`,
    hiddenColumns: unit === "customer" ? ["customer"] : undefined,
  });

  return (
    <PageShell>
      <PageHeader
        title="Sevke Hazır İşler"
        description={`${TERIM.terbiyeIsEmri.tekil}, gelen belge, parti ya da müşteri başına sevke hazırlık. Hazır = Bitmiş Depo / 2. kalite stoktaki toplar; kural fabrika ayarından (tümü bitti ya da metre eşiği). Satıra tıklayınca toplar açılır, hazır olanlar oradan sevke alınır.`}
        actions={<RefreshButton queryKey={READY_WORKS_QUERY_KEY} />}
      />
      <ListToolbar className="flex-row flex-wrap items-center">
        <ReadyWorksToolbar tabs={tabs} unit={unit} onUnit={setPicked} stateFilter={stateFilter} onStateFilter={setStateFilter} />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Sevke hazır işler" />
        </div>
      </ListToolbar>
      {/* "HATA" ile "KAYIT YOK" ayrı ekranlar (DataTable.isError); sonraki sayfa dibe inince kendiliğinden gelir. */}
      <DataTable
        table={table}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={() => void q.refetch()}
        errorText="Bu bir “hazır iş yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı."
        emptyText="Bu filtrede iş yok."
        emptyDescription="Tamamı sevk edilmiş işler listede görünmez."
        onRowClick={setOpenRow}
        rowTitle={(r) => `${r.label} toplarını aç`}
        exportName="Sevke hazır işler"
        loadMore={{ hasMore: Boolean(q.hasNextPage), isFetchingMore: q.isFetchingNextPage, onLoadMore: () => void q.fetchNextPage() }}
      />
      {!q.isLoading && !q.isError && (
        <ListFooter loaded={rows.length} hasMore={Boolean(q.hasNextPage)} isFetchingMore={q.isFetchingNextPage} summary={first ? <SummaryStrip s={first.summary} /> : undefined} />
      )}
      <ShipFlow openRow={openRow} onCloseRow={() => setOpenRow(null)} canShip={canShip} />
    </PageShell>
  );
}
