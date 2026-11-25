// =============================================================================
// SARF STOĞU (kuşak / kurşun şeridi)
// =============================================================================
// Bakiye backend defterinden türetilir; giriş mal kabulden, düşüm üretim izinden (kurşun / tambur) doğar —
// bu ekranda yazım yok. Eksi bakiye HATA değildir (tüketim girişten önce yazılmış): görünür, nötr uyarılır.
// "İstek düştü" ile "kayıt yok" ayrı cümledir (İplik Stoğu emsali). Süzme sunucuda.
// =============================================================================
import { useMemo, useState } from "react";
import { unitLabel } from "@/lib/item-unit";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { BandStats, ListFooter, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { ListSearchBox } from "@/components/data-table/ListSearchBox";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { flagSettingTrail } from "@/lib/flag-setting-path";
import { listConsumableStock, type ConsumableStockRow } from "./service";
import { ConsumableMovementsSheet } from "./ConsumableMovementsSheet";
import { ToolbarToggle } from "@/components/data-table/ToolbarToggle";
import { MIN_STOCK_BADGE_TEXT, MinStockCell, minStockText } from "@/components/operations/MinStockCell";

const COLUMNS: ColumnDef<ConsumableStockRow>[] = [
  { accessorKey: "code", header: "Kod", cell: ({ row }) => <span className="font-mono">{row.original.code}</span> },
  {
    accessorKey: "name",
    header: "Kalem",
    size: 260,
    cell: ({ row: { original: r } }) => (
      <span>
        {r.name}
        {!r.isActive && <span className="ml-2 text-xs text-muted-foreground">(pasif)</span>}
      </span>
    ),
  },
  {
    id: "balance",
    header: "Bakiye",
    meta: { label: "Bakiye", align: "right", exportValue: (r) => `${formatNumber(r.balance, 3)} ${unitLabel(r.unit)}` },
    cell: ({ row: { original: r } }) => (
      <span className={`tabular-nums ${r.negative ? "text-amber-600" : ""}`}>
        {r.negative && <AlertTriangle className="mr-1 inline h-4 w-4" aria-label="Eksi bakiye — mal kabul girişini kontrol edin" />}
        {formatNumber(r.balance, 3)} {unitLabel(r.unit)}
      </span>
    ),
  },
  {
    id: "minStock",
    header: "Asgari stok",
    meta: { label: "Asgari stok", align: "right", exportValue: (r) => `${minStockText(r.minStockQty ?? null, r.unit)}${r.belowMinStock ? ` (${MIN_STOCK_BADGE_TEXT})` : ""}` },
    cell: ({ row: { original: r } }) => <MinStockCell minStockQty={r.minStockQty ?? null} below={r.belowMinStock === true} unit={r.unit} />,
  },
];

const actionsColumn = (onOpen: (r: ConsumableStockRow) => void): ColumnDef<ConsumableStockRow> => ({
  id: "actions",
  header: () => <span className="sr-only">Eylemler</span>,
  enableHiding: false,
  size: 120,
  meta: { label: "Eylemler", align: "right" },
  cell: ({ row }) => (
    <Button size="sm" variant="ghost" onClick={() => onOpen(row.original)}>
      Hareketler
    </Button>
  ),
});

export function ConsumableStockPage() {
  const [search, setSearch] = useState("");
  const [belowMin, setBelowMin] = useState(false);
  const [open, setOpen] = useState<ConsumableStockRow | null>(null);
  const q = useQuery({ queryKey: ["consumable-stock", search, belowMin], queryFn: () => listConsumableStock({ search, belowMin }) });
  const belowMinCount = q.data?.summary.belowMinCount ?? 0;
  const data = q.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const columns = useMemo(() => [...COLUMNS, actionsColumn(setOpen)], []);
  const table = useLocalTable({ tableKey: "consumable:stock", data: rows, columns, getRowId: (r) => r.itemId });
  return (
    <PageShell>
      <PageHeader
        title="Sarf Stoğu"
        description="Kuşak ve kurşun şeridi gibi sarf malzemeleri. Giriş mal kabulden, düşüm üretim adımından gelir; satırlar silinmez, geri alma ters kayıt yazar."
      />
      {data && !data.enabled && (
        <p className="shrink-0 border-b px-4 py-2 text-sm text-muted-foreground">
          Sarf stoğu takibi kapalı — {flagSettingTrail("consumableStockEnabled")} → &quot;Sarf stoğu tut&quot; açılınca mal kabul sarf satırı alır ve üretim düşer.
        </p>
      )}
      <ListToolbar className="flex-row flex-wrap items-center">
        <ListSearchBox value={search} onSearchChange={setSearch} searchHint="Kalem adı ya da kodu ara" />
        <ToolbarToggle checked={belowMin} onCheckedChange={setBelowMin} label={MIN_STOCK_BADGE_TEXT} title="Yalnız bakiyesi ürün kartındaki asgari stoğun altında olan kalemler" />
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Sarf stoğu" />
        </div>
      </ListToolbar>
      <DataTable
        table={table}
        exportName="Sarf stoğu"
        isLoading={q.isLoading}
        isError={q.isError}
        errorText="Sarf stoğu yüklenemedi — bağlantıyı, Ticaret modülünü ve yetkinizi kontrol edin."
        onRetry={() => void q.refetch()}
        emptyText={belowMin ? "Asgari stoğun altına düşen kalem yok." : search ? "Aramaya uyan kalem yok." : "Sarf türünde kalem yok."}
        emptyDescription={belowMin || search ? undefined : "Ürün kartında türü “Sarf” olan kalemler burada listelenir."}
      />
      <ListFooter
        loaded={rows.length}
        summary={
          data && (
            <BandStats
              label="Sarf stoğu özeti"
              items={[
                { key: "items", label: "Kalem", value: data.summary.itemCount },
                ...(data.summary.negativeCount > 0 ? [{ key: "neg", label: "Eksi bakiye", value: data.summary.negativeCount, tone: "warn" as const }] : []),
                ...(belowMinCount > 0 ? [{ key: "belowMin", label: MIN_STOCK_BADGE_TEXT, value: belowMinCount, tone: "warn" as const }] : []),
              ]}
            />
          )
        }
      />
      <ConsumableMovementsSheet row={open} onClose={() => setOpen(null)} />
    </PageShell>
  );
}
