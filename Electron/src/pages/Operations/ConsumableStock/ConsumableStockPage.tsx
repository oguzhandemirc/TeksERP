// =============================================================================
// SARF STOĞU (kuşak / kurşun şeridi)
// =============================================================================
// Bakiye backend defterinden türetilir; giriş mal kabulden, düşüm üretim izinden (kurşun / tambur) doğar —
// bu ekranda yazım yok. Eksi bakiye HATA değildir (tüketim girişten önce yazılmış): görünür, nötr uyarılır.
// "İstek düştü" ile "kayıt yok" ayrı cümledir (İplik Stoğu emsali). Süzme sunucuda.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ListBody, ListFooter, ListMessage, ListToolbar } from "@/components/layout/ListPage";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { useLocalTable } from "@/hooks/useLocalTable";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { flagSettingTrail } from "@/lib/flag-setting-path";
import { listConsumableStock, type ConsumableStockRow } from "./service";
import { ConsumableMovementsSheet } from "./ConsumableMovementsSheet";

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
    meta: { label: "Bakiye", align: "right", exportValue: (r) => `${formatNumber(r.balance, 3)} ${r.unit}` },
    cell: ({ row: { original: r } }) => (
      <span className={`tabular-nums ${r.negative ? "text-amber-600" : ""}`}>
        {r.negative && <AlertTriangle className="mr-1 inline h-4 w-4" aria-label="Eksi bakiye — mal kabul girişini kontrol edin" />}
        {formatNumber(r.balance, 3)} {r.unit}
      </span>
    ),
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
  const [open, setOpen] = useState<ConsumableStockRow | null>(null);
  const q = useQuery({ queryKey: ["consumable-stock", search], queryFn: () => listConsumableStock(search) });
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
        <Input className="w-full sm:w-72" placeholder="Ara…" title="Kalem adı ya da kodu ara" aria-label="Kalem adı ya da kodu ara" value={search} onChange={(e) => setSearch(e.target.value)} />
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.summary.itemCount} kalem{data.summary.negativeCount > 0 ? ` · ${data.summary.negativeCount} eksi bakiye` : ""}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <DataTableTools table={table} compact exportName="Sarf stoğu" />
        </div>
      </ListToolbar>
      {!q.isError && rows.length > 0 ? (
        <DataTable table={table} exportName="Sarf stoğu" />
      ) : (
        <ListBody>
          <ListMessage>
            {q.isError ? (
              <p className="text-sm text-destructive">Sarf stoğu yüklenemedi — bağlantıyı, Ticaret modülünü ve yetkinizi kontrol edin.</p>
            ) : data ? (
              <p className="text-sm text-muted-foreground">Sarf türünde kalem yok. Ürün kartında türü &quot;Sarf&quot; olan kalemler burada listelenir.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Yükleniyor…</p>
            )}
          </ListMessage>
        </ListBody>
      )}
      <ListFooter loaded={rows.length} />
      <ConsumableMovementsSheet row={open} onClose={() => setOpen(null)} />
    </PageShell>
  );
}
