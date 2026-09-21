import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Boxes, Lock, Plus, Search, Truck } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageBody } from "@/components/layout/PageShell";
import { cn } from "@/lib/utils";
import { sackHubService } from "./service";
import { invalidateSackHub } from "./useSackData";
import { LotRowMenu } from "./PackingLotHeader";
import { PackingLotSummaryCards } from "./PackingLotSummaryCards";
import { lotSackLabel, lotStatusLabel } from "./packingLotUi";
import { DEFAULT_LOT_SORT, filterLots, nextLotSort, sortLots, type LotSort, type LotSortKey, type LotStatusFilter } from "./packingLotList";
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
}: {
  customerId: string;
  /** Parti id ya da `UNGROUPED_FILTER_VALUE` → çuval listesine geç. */
  onOpen: (filterValue: string) => void;
}) {
  const qc = useQueryClient();
  const navigateActive = useTabsStore((s) => s.navigateActive);
  // Süzme/sıralama İSTEMCİDE: liste cari başına ve sunucu tamamını döner (cursor yok).
  const [status, setStatus] = useState<LotStatusFilter>("OPEN");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LotSort>(DEFAULT_LOT_SORT);
  const lots = useQuery({
    queryKey: ["packing-groups", customerId, "ALL"],
    queryFn: () => sackHubService.listPackingGroups(customerId, "ALL"),
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
  const rows = sortLots(filterLots(all, { query, status }), sort);
  const s: PackingLotCustomerSummary | undefined = summary.data?.data;

  return (
    <PageBody className="px-4 pb-4">
      <PackingLotSummaryCards s={s} onOpenPool={() => onOpen(UNGROUPED_FILTER_VALUE)} />
      <LotToolbar
        status={status}
        onStatus={setStatus}
        counts={{ open: s?.openLotCount, closed: s?.closedLotCount }}
        query={query}
        onQuery={setQuery}
        creating={create.isPending}
        onCreate={() => create.mutate()}
        onShipments={() => navigateActive(`/operations/shipments?filter[customerId]=${encodeURIComponent(customerId)}`)}
      />
      <table className="w-full text-sm">
        <LotTableHead sort={sort} onSort={(key) => setSort((c) => nextLotSort(c, key))} />
        <tbody>
          {status !== "CLOSED" && !query && <UngroupedRow s={s} onOpen={() => onOpen(UNGROUPED_FILTER_VALUE)} />}
          {rows.map((lot) => (
            <LotRow key={lot.id} lot={lot} onOpen={() => onOpen(lot.id)} onDone={refresh} />
          ))}
          {!lots.isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                {query ? "Aramayla eşleşen parti yok." : `Bu carinin ${status === "OPEN" ? "açık " : status === "CLOSED" ? "sevk edilmiş " : ""}sevk partisi yok — "Sevk Partisi Oluştur" ile başlayın.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </PageBody>
  );
}

/** Başlık satırı: durum segmenti · arama · "Sevk Partisi Oluştur". */
function LotToolbar(p: {
  status: LotStatusFilter;
  onStatus: (v: LotStatusFilter) => void;
  counts: { open?: number; closed?: number };
  query: string;
  onQuery: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
  onShipments: () => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Boxes className="h-4 w-4" /> Sevk partileri
      </span>
      <StatusSegment value={p.status} onChange={p.onStatus} counts={p.counts} />
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="Parti adı / not ara…" className="h-8 w-56 pl-7 text-xs" />
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
    <thead className="text-xs text-muted-foreground">
      <tr className="border-b">
        {th("name", "Parti")}
        {th("sackCount", "Çuval")}
        {th("totalQty", "Metraj", "r")}
        {th("weightKg", "Kg", "r")}
        <th className="py-1.5 text-left font-medium">Durum</th>
        {th("createdAt", "Tarih")}
        <th className="py-1.5 text-left font-medium">Not</th>
        <th className="w-8" />
      </tr>
    </thead>
  );
}

/** Sıralanabilir başlık — aktif anahtarda yön oku. */
function SortTh({ label, align, active, onClick }: { label: string; align: "l" | "r"; active: "asc" | "desc" | null; onClick: () => void }) {
  return (
    <th className={cn("py-1.5 font-medium", align === "r" ? "text-right" : "text-left")}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-0.5 hover:text-foreground", active && "text-foreground")}>
        {label}
        {active === "asc" && <ArrowUp className="h-3 w-3" />}
        {active === "desc" && <ArrowDown className="h-3 w-3" />}
      </button>
    </th>
  );
}

/** Açık · Sevk edilmiş · Tümü — sayılarıyla. "Sevk edilmiş" = son çuvalı da giden parti (elle kapatma yok). */
function StatusSegment({ value, onChange, counts }: { value: LotStatusFilter; onChange: (v: LotStatusFilter) => void; counts: { open?: number; closed?: number } }) {
  const items: { v: LotStatusFilter; label: string }[] = [
    { v: "OPEN", label: counts.open != null ? `Açık (${counts.open})` : "Açık" },
    { v: "CLOSED", label: counts.closed != null ? `Sevk edilmiş (${counts.closed})` : "Sevk edilmiş" },
    { v: "ALL", label: "Tümü" },
  ];
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          onClick={() => onChange(i.v)}
          className={cn("rounded px-2 py-0.5 text-xs", value === i.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Sabit "Partisiz çuvallar (havuz)" satırı — boşken soluk, kaybolmaz. */
function UngroupedRow({ s, onOpen }: { s: PackingLotCustomerSummary | undefined; onOpen: () => void }) {
  const u = s?.ungrouped;
  const empty = !u || u.sackCount === 0;
  return (
    <tr className={cn("cursor-pointer border-b hover:bg-muted/40", empty && "text-muted-foreground")} onClick={onOpen}>
      <td className="py-2 font-medium">Partisiz çuvallar (havuz)</td>
      <td className="py-2">{u ? `${u.sackCount} çuval` : "…"}</td>
      <td className="py-2 text-right tabular-nums">{u ? `${fmtQty(u.totalQty)} m` : ""}</td>
      <td className="py-2 text-right tabular-nums">{u ? fmtKg(u.weightKg) : ""}</td>
      <td className="py-2 text-xs">{empty ? "boş" : "partiye alınmayı bekliyor"}</td>
      <td className="py-2" />
      <td className="py-2" />
      <td className="py-2" />
    </tr>
  );
}

function LotRow({ lot, onOpen, onDone }: { lot: PackingGroup; onOpen: () => void; onDone: () => void }) {
  const closed = lot.status === "CLOSED";
  return (
    <tr className={cn("cursor-pointer border-b hover:bg-muted/40", closed && "text-muted-foreground")} onClick={onOpen}>
      <td className="py-2 font-medium">
        <span className="inline-flex items-center gap-1.5">
          {closed && <Lock className="h-3 w-3" />}
          {lot.name}
        </span>
      </td>
      <td className="py-2 tabular-nums">{lotSackLabel(lot)}</td>
      <td className="py-2 text-right tabular-nums">{fmtQty(lot.totalQty)} m</td>
      <td className="py-2 text-right tabular-nums">{fmtKg(lot.weightKg)}</td>
      <td className="py-2 text-xs">{lotStatusLabel(lot.status)}</td>
      <td className="py-2 text-xs tabular-nums">{fmtDate(lot.createdAt)}</td>
      <td className="max-w-[28ch] truncate py-2 text-xs italic text-muted-foreground" title={lot.note ?? undefined}>{lot.note ?? ""}</td>
      <td className="py-1" onClick={(e) => e.stopPropagation()}>
        <LotRowMenu lot={lot} onDone={onDone} />
      </td>
    </tr>
  );
}
