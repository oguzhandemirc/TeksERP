import { useMemo, useState } from "react";
import type { Table } from "@tanstack/react-table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Truck } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { POOL_ROW_ID, lotRowClass, usePackingLotTable, type LotListRow } from "./PackingLotTable";
import { useAttemptToken } from "@/lib/attemptToken";
import { sackHubService } from "./service";
import { invalidateSackHub, PACKING_LOT_STALE_MS } from "./useSackData";
import { LotActionDialogs, type LotAction } from "./PackingLotActions";
import { PackingLotSummaryCards } from "./PackingLotSummaryCards";
import { DEFAULT_LOT_SORT, filterLots, nextLotSort, sortLots, type LotSort } from "./packingLotList";
import { UNGROUPED_FILTER_VALUE, type PackingGroup, type PackingLotCustomerSummary } from "./types";
import { ListBody, ListFooter, ListToolbar } from "@/components/layout/ListPage";

/**
 * CARİ ÇALIŞMA ALANI — parti LİSTESİ (sevk partisi modu, 2026-09-22 kullanıcı kararı).
 *
 * Cariye girince partiler SATIR olarak gelir (çip değil); en üstte sabit "Partisiz
 * çuvallar (havuz)" satırı — havuz boşsa soluk kalır, KAYBOLMAZ ("sahipsiz çuval yok"
 * bilgisi de bilgidir). Satıra tıklamak `filter[packingGroupId]`yi yazar; çuval listesi
 * bugünkü sunucu süzgeciyle gelir (cursor kuralı korunur). Üstte tek satır özet.
 */
export function PackingLotListView({
  customerId,
  onOpen,
  onOpenUnweighed,
}: {
  customerId: string;
  /** Parti id ya da `UNGROUPED_FILTER_VALUE` → çuval listesine geç. */
  onOpen: (filterValue: string) => void;
  /** "Tartılmamış çuval" kartı → carinin bütün çuvalları, tartı süzgeciyle. */
  onOpenUnweighed: () => void;
}) {
  const qc = useQueryClient();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  // Süzme/sıralama İSTEMCİDE: liste cari başına ve sunucu tamamını döner (cursor yok).
  // YALNIZ AÇIK partiler: sevk edilenler bu ekranda izlenmez, yerleri Sevkiyatlar
  // (saha 2026-09-22: "Açık/Sevk edilmiş/Tümü süzgecine gerek yok").
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LotSort>(DEFAULT_LOT_SORT);
  // Satır menüsünden gelen toplu eylem (sevk · havuza çıkar · depoya çek) — diyaloglar tek kez burada.
  const [action, setAction] = useState<LotAction | null>(null);
  const lots = useQuery({
    queryKey: ["packing-groups", customerId, "OPEN"],
    staleTime: PACKING_LOT_STALE_MS,
    queryFn: () => sackHubService.listPackingGroups(customerId, "OPEN"),
  });
  const summary = useQuery({
    queryKey: ["packing-lot-summary", customerId],
    staleTime: PACKING_LOT_STALE_MS,
    queryFn: () => sackHubService.packingLotSummary(customerId),
  });
  const refresh = () => {
    invalidateSackHub(qc);
    void qc.invalidateQueries({ queryKey: ["packing-groups"] });
    void qc.invalidateQueries({ queryKey: ["packing-lot-summary"] });
  };
  const create = useCreateLot(customerId, (res) => {
    toast.success(`${res.data.name} oluşturuldu — çuval açmaya başlayabilirsiniz.`);
    refresh();
    onOpen(res.data.id);
  });
  const all: PackingGroup[] = lots.data?.data ?? [];
  const rows = sortLots(filterLots(all, { query, status: "OPEN" }), sort);
  const s: PackingLotCustomerSummary | undefined = summary.data?.data;
  // Havuz satırı aramada çizilmez (parti değil); diğer her durumda sabit ilk satır.
  const tableRows = useMemo<LotListRow[]>(() => [...(query ? [] : [{ id: POOL_ROW_ID, pool: s?.ungrouped } as LotListRow]), ...rows], [query, s, rows]);
  const table = usePackingLotTable(tableRows, { sort, onSort: (key) => setSort((c) => nextLotSort(c, key)), onDone: refresh, onAction: setAction });

  return (
    <>
      <ListToolbar>
        <PackingLotSummaryCards
          s={s}
          openLots={lots.data ? all : undefined}
          onOpenUnweighed={onOpenUnweighed}
          onOpenOrders={() => navigateActive(`/operations/orders?filter[customerId]=${encodeURIComponent(customerId)}`)}
        />
      </ListToolbar>
      {/* Liste standardı: arama/oluştur şeridi sabit bant, tablo kenardan kenara (kart yok). */}
      <LotToolbar
        query={query}
        onQuery={setQuery}
        creating={create.isPending}
        onCreate={() => create.mutate()}
        onShipments={() => navigateActive(`/operations/shipments?filter[customerId]=${encodeURIComponent(customerId)}`)}
        tools={<DataTableTools table={table} compact exportName="Sevk partileri" />}
      />
      <LotListBody table={table} rowCount={tableRows.length} lotCount={rows.length} loading={lots.isLoading} query={query} onOpen={onOpen} />
      <ListFooter loaded={rows.length} label={`${rows.length} açık parti`} />
      <LotActionDialogs action={action} onClose={() => setAction(null)} onDone={refresh} />
    </>
  );
}

/** Tablo ya da boş durum — havuz satırı tek başınaysa "parti yok" ipucu tablonun altında (havuz kaybolmaz). */
function LotListBody({ table, rowCount, lotCount, loading, query, onOpen }: { table: Table<LotListRow>; rowCount: number; lotCount: number; loading: boolean; query: string; onOpen: (filterValue: string) => void }) {
  if (rowCount > 0) {
    return (
      <>
        <DataTable table={table} rowClassName={lotRowClass} onRowClick={(r) => onOpen(r.id === POOL_ROW_ID ? UNGROUPED_FILTER_VALUE : r.id)} exportName="Sevk partileri" />
        {!loading && lotCount === 0 && (
          <p className="shrink-0 border-t py-3 text-center text-xs text-muted-foreground">
            Bu carinin açık sevk partisi yok — &quot;Sevk Partisi Oluştur&quot; ile başlayın.
          </p>
        )}
      </>
    );
  }
  return (
    <ListBody>
      {!loading && (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {query ? "Aramayla eşleşen parti yok." : 'Bu carinin açık sevk partisi yok — "Sevk Partisi Oluştur" ile başlayın.'}
        </p>
      )}
    </ListBody>
  );
}

/** Başlık satırı: arama · "Sevk Partisi Oluştur" · Sevkiyatlar. */
type CreatedLot = Awaited<ReturnType<typeof sackHubService.createPackingGroup>>;

/** "Yeni parti" — token mantıksal deneme başına (kk1.md), tıklama başına değil. */
function useCreateLot(customerId: string, onCreated: (res: CreatedLot) => void) {
  const attempt = useAttemptToken();
  return useMutation({
    mutationFn: () => sackHubService.createPackingGroup({ customerId, sackIds: [], clientToken: attempt.token() }),
    onError: (e) => attempt.onFailure(e),
    onSuccess: (res) => {
      attempt.onSuccess();
      onCreated(res);
    },
  });
}

function LotToolbar(p: {
  query: string;
  onQuery: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
  onShipments: () => void;
  tools: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="Ara…" title="Parti adı / kod / not ara" aria-label="Parti adı / kod / not ara" className="h-9 w-72 pl-7" />
      </div>
      <Button size="sm" className="ml-auto h-8 gap-1" disabled={p.creating} onClick={p.onCreate}>
        <Plus className="h-3.5 w-3.5" /> {p.creating ? "Açılıyor…" : "Sevk Partisi Oluştur"}
      </Button>
      {/* Sevk edilenler bu ekranda İZLENMEZ — carinin sevkiyatları kendi ekranında (saha 2026-09-22). */}
      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={p.onShipments} title="Bu carinin sevkiyatları">
        <Truck className="h-3.5 w-3.5" /> Sevkiyatlar
      </Button>
      {p.tools}
    </div>
  );
}
