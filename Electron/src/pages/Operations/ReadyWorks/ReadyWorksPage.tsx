// SEVKE HAZIR İŞLER (D4-J3, ister 2.4 / 2.10) — iş emri / gelen belge / parti / müşteri başına sevke hazırlık.
// Sekme = `groupBy`; durum süzgeci query'de (liste + imleç + özet şeridi sunucuda aynı where'den). Satır → toplar
// çekmecesi; "sevke al" mevcut Hızlı Sevk boğazı. Gelen belge modülü kapalıyken iki sekme yok, istek de yok.
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
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
import { ReadyWorksTable, ReadyWorksToolbar, SummaryStrip } from "./ReadyWorksTable";

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

  return (
    <PageShell>
      <PageHeader
        title="Sevke Hazır İşler"
        description={`${TERIM.terbiyeIsEmri.tekil}, gelen belge, parti ya da müşteri başına sevke hazırlık. Hazır = Bitmiş Depo / 2. kalite stoktaki toplar; kural fabrika ayarından (tümü bitti ya da metre eşiği). Satıra tıklayınca toplar açılır, hazır olanlar oradan sevke alınır.`}
        actions={<RefreshButton queryKey={READY_WORKS_QUERY_KEY} />}
      />
      <ListToolbar>
        {!q.isLoading && !q.isError && first && <SummaryStrip s={first.summary} />}
        <ReadyWorksToolbar tabs={tabs} unit={unit} onUnit={setPicked} stateFilter={stateFilter} onStateFilter={setStateFilter} />
      </ListToolbar>
      <ListBody>
        {q.isLoading ? (
          <ListMessage className="text-sm text-muted-foreground">Yükleniyor…</ListMessage>
        ) : q.isError ? (
          <ListMessage>
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center text-sm">
              <p className="font-medium text-destructive">Liste yüklenemedi.</p>
              <p className="mt-1 text-muted-foreground">Bu bir “hazır iş yok” cevabı değildir — istek reddedildi ya da sunucuya ulaşılamadı.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()}>
                Tekrar dene
              </Button>
            </div>
          </ListMessage>
        ) : (
          <>
            {rows.length === 0 ? (
              <ListMessage>
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Bu süzgeçte iş yok. Tamamı sevk edilmiş işler listede görünmez.
                </div>
              </ListMessage>
            ) : (
              <ReadyWorksTable rows={rows} unit={unit} unitLabel={tabs.find((t) => t.unit === unit)?.label ?? "İş"} onOpen={setOpenRow} />
            )}
          </>
        )}
      </ListBody>
      {!q.isLoading && !q.isError && rows.length > 0 && (
        <ListFooter loaded={rows.length} hasMore={Boolean(q.hasNextPage)} isFetchingMore={q.isFetchingNextPage}>
          {q.hasNextPage && (
            <Button variant="outline" size="sm" className="h-7" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Yükleniyor…" : "Daha fazla"}
            </Button>
          )}
        </ListFooter>
      )}
      <ShipFlow openRow={openRow} onCloseRow={() => setOpenRow(null)} canShip={canShip} />
    </PageShell>
  );
}
