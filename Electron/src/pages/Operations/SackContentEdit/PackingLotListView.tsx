import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, PackageOpen, Plus, Search, Truck } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageBody } from "@/components/layout/PageShell";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { LotRowMenu } from "./PackingLotHeader";
import { LotActionDialogs, type LotAction } from "./PackingLotActions";
import { PackingLotSummaryCards } from "./PackingLotSummaryCards";
import { lotSackLabel } from "./packingLotUi";
import { DEFAULT_LOT_SORT, filterLots, nextLotSort, sortLots, type LotSort, type LotSortKey } from "./packingLotList";
import { UNGROUPED_FILTER_VALUE, type PackingGroup, type PackingLotCustomerSummary } from "./types";

const fmtQty = (n: number): string => n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
const fmtKg = (n: number | null): string => (n == null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: 1 }));
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });

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
    queryFn: () => sackHubService.listPackingGroups(customerId, "OPEN"),
  });
  const summary = useQuery({
    queryKey: ["packing-lot-summary", customerId],
    queryFn: () => sackHubService.packingLotSummary(customerId),
  });
  const refresh = () => {
    invalidateSackHub(qc);
    void qc.invalidateQueries({ queryKey: ["packing-groups"] });
    void qc.invalidateQueries({ queryKey: ["packing-lot-summary"] });
  };
  const create = useMutation({
    mutationFn: () => sackHubService.createPackingGroup({ customerId, sackIds: [], clientToken: crypto.randomUUID() }),
    onSuccess: (res) => {
      toast.success(`${res.data.name} oluşturuldu — çuval açmaya başlayabilirsiniz.`);
      refresh();
      onOpen(res.data.id);
    },
  });
  const all: PackingGroup[] = lots.data?.data ?? [];
  const rows = sortLots(filterLots(all, { query, status: "OPEN" }), sort);
  const s: PackingLotCustomerSummary | undefined = summary.data?.data;

  return (
    <PageBody className="px-4 pb-4">
      <PackingLotSummaryCards
        s={s}
        openLots={lots.data ? all : undefined}
        onOpenUnweighed={onOpenUnweighed}
        onOpenOrders={() => navigateActive(`/operations/orders?filter[customerId]=${encodeURIComponent(customerId)}`)}
      />
      {/* Araç çubuğu + tablo TEK KART: kapı ekranıyla aynı dil (havada duran şerit yok). */}
      <div className="overflow-hidden rounded-lg border">
      <LotToolbar
        query={query}
        onQuery={setQuery}
        creating={create.isPending}
        onCreate={() => create.mutate()}
        onShipments={() => navigateActive(`/operations/shipments?filter[customerId]=${encodeURIComponent(customerId)}`)}
      />
      <table className="w-full text-sm">
        <LotTableHead sort={sort} onSort={(key) => setSort((c) => nextLotSort(c, key))} />
        <tbody>
          {!query && <UngroupedRow s={s} onOpen={() => onOpen(UNGROUPED_FILTER_VALUE)} />}
          {rows.map((lot) => (
            <LotRow key={lot.id} lot={lot} onOpen={() => onOpen(lot.id)} onDone={refresh} onAction={setAction} />
          ))}
          {!lots.isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                {query ? "Aramayla eşleşen parti yok." : 'Bu carinin açık sevk partisi yok — "Sevk Partisi Oluştur" ile başlayın.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      <LotActionDialogs action={action} onClose={() => setAction(null)} onDone={refresh} />
    </PageBody>
  );
}

/** Başlık satırı: arama · "Sevk Partisi Oluştur" · Sevkiyatlar. */
function LotToolbar(p: {
  query: string;
  onQuery: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
  onShipments: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="Parti adı / kod / not ara…" className="h-9 w-72 pl-7" />
      </div>
      <Button size="sm" className="ml-auto h-8 gap-1" disabled={p.creating} onClick={p.onCreate}>
        <Plus className="h-3.5 w-3.5" /> {p.creating ? "Açılıyor…" : "Sevk Partisi Oluştur"}
      </Button>
      {/* Sevk edilenler bu ekranda İZLENMEZ — carinin sevkiyatları kendi ekranında (saha 2026-09-22). */}
      <Button size="sm" variant="outline" className="h-8 gap-1" onClick={p.onShipments} title="Bu carinin sevkiyatları">
        <Truck className="h-3.5 w-3.5" /> Sevkiyatlar
      </Button>
    </div>
  );
}

/** Başlık satırı — sıralanabilir kolonlar `SortTh`, diğerleri düz. */
function LotTableHead({ sort, onSort }: { sort: LotSort; onSort: (key: LotSortKey) => void }) {
  const th = (key: LotSortKey, label: string, align: "l" | "r" = "l") => (
    <SortTh key={key} label={label} align={align} active={sort.key === key ? sort.dir : null} onClick={() => onSort(key)} />
  );
  return (
    <thead className="bg-background text-xs text-muted-foreground">
      <tr className="border-b">
        {th("name", "Parti")}
        {th("code", "Kod")}
        {th("sackCount", "Çuval", "r")}
        {th("totalQty", "Metraj", "r")}
        {th("weightKg", "Kg", "r")}
        {th("createdAt", "Tarih", "r")}
        <th className="px-3 py-1.5 text-left font-medium">Not</th>
        <th className="w-14" />
      </tr>
    </thead>
  );
}

/** Sıralanabilir başlık — aktif anahtarda yön oku. */
function SortTh({ label, align, active, onClick }: { label: string; align: "l" | "r"; active: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <th className={cn("px-3 py-1.5 font-medium", align === "r" ? "text-right" : "text-left")}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-0.5 hover:text-foreground", active && "text-foreground")}>
        {label}
        {active === "asc" && <ArrowUp className="h-3 w-3" />}
        {active === "desc" && <ArrowDown className="h-3 w-3" />}
      </button>
    </th>
  );
}

/**
 * Sabit "Partisiz çuvallar (havuz)" satırı — bir PARTİ değil, havuzun kendisi; bu
 * yüzden parti satırlarından görsel olarak ayrılır (tonlu zemin + kesik alt çizgi +
 * ikon). Boşken soluk, KAYBOLMAZ.
 */
function UngroupedRow({ s, onOpen }: { s: PackingLotCustomerSummary | undefined; onOpen: () => void }) {
  const u = s?.ungrouped;
  const empty = !u || u.sackCount === 0;
  return (
    <tr
      className={cn(
        "cursor-pointer border-b border-dashed bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50",
        empty && "text-muted-foreground",
      )}
      onClick={onOpen}
    >
      <td className="px-3 py-2 font-medium">
        <span className="inline-flex items-center gap-1.5">
          <PackageOpen className="h-3.5 w-3.5 text-muted-foreground" /> Partisiz çuvallar (havuz)
        </span>
      </td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2 text-right tabular-nums">{u ? `${u.sackCount} çuval` : "…"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{u ? `${fmtQty(u.totalQty)} m` : ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">{u ? fmtKg(u.weightKg) : ""}</td>
      <td className="px-3 py-2" />
      <td className="px-3 py-2" />
      <td className="py-2" />
    </tr>
  );
}

function LotRow({ lot, onOpen, onDone, onAction }: { lot: PackingGroup; onOpen: () => void; onDone: () => void; onAction: (a: LotAction) => void }) {
  const closed = lot.status === "CLOSED";
  return (
    <tr className={cn("cursor-pointer border-b hover:bg-muted/40", closed && "text-muted-foreground")} onClick={onOpen}>
      <td className="px-3 py-2 font-medium">
        <span className="inline-flex items-center gap-1.5">
          {closed && <Lock className="h-3 w-3" />}
          {lot.name}
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{lot.code ?? ""}</td>
      <td className="px-3 py-2 text-right tabular-nums">{lotSackLabel(lot)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtQty(lot.totalQty)} m</td>
      <td className="px-3 py-2 text-right tabular-nums">{fmtKg(lot.weightKg)}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums">{fmtDate(lot.createdAt)}</td>
      <td className="max-w-[28ch] truncate px-3 py-2 text-xs italic text-muted-foreground" title={lot.note ?? undefined}>{lot.note ?? ""}</td>
      <td className="py-1 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
        <LotRowMenu lot={lot} onDone={onDone} onAction={onAction} />
      </td>
    </tr>
  );
}
