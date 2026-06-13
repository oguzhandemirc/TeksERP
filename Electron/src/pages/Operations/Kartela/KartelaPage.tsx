import { useState } from "react";
import { Send, PackageCheck, Package, Palette } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { RollsTable } from "@/pages/Operations/Rolls/RollsTable";
import { SwatchesPanel } from "@/pages/Operations/Rolls/SwatchesPanel";
import { kartelaService, type KartelaDispatchListItem, type KartelaReceiptListItem } from "./service";
import { kartelaDispatchColumns, kartelaReceiptColumns } from "./kartelaColumns";
import { KartelaDetailSheet, type KartelaSelection } from "./KartelaDetailSheet";

const STATUS_FILTER: FilterDef = {
  kind: "select",
  key: "status",
  label: "Durum",
  options: [
    { value: "active", label: "Aktif" },
    { value: "cancelled", label: "İptal" },
    { value: "all", label: "Tümü" },
  ],
};

const FIRM_FILTER: FilterDef = {
  kind: "lookup",
  key: "subcontractorId",
  label: "Firma",
  service: subcontractorService,
  queryKey: "subcontractors",
};

const DISPATCH_FILTERS: FilterDef[] = [
  STATUS_FILTER,
  FIRM_FILTER,
  { kind: "dateRange", label: "Tarih", defaultField: "dispatchedAt" },
];

const RECEIPT_FILTERS: FilterDef[] = [
  STATUS_FILTER,
  FIRM_FILTER,
  { kind: "dateRange", label: "Tarih", defaultField: "receivedAt" },
];

// Tek kokpit: belge akışı (Sevkler/Kabuller) + envanter (Kartelada Toplar =
// AT_KARTELA rulolar, Üretilen Kartelalar = swatch'lar). Envanter görünümleri
// Toplar sayfasından buraya taşındı — kartela tek yerden yönetilir.
type Tab = "dispatches" | "receipts" | "rolls" | "swatches";

const TABS: { key: Tab; label: string; Icon: typeof Send }[] = [
  { key: "dispatches", label: "Sevkler", Icon: Send },
  { key: "receipts", label: "Kabuller", Icon: PackageCheck },
  { key: "rolls", label: "Kartelada Toplar", Icon: Package },
  { key: "swatches", label: "Üretilen Kartelalar", Icon: Palette },
];

function KartelaTabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <div className="flex items-center gap-1 border-b px-3">
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onTab(t.key)}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab === t.key
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          <t.Icon className="h-4 w-4" />
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function KartelaPage() {
  const [tab, setTab] = useState<Tab>("dispatches");
  const [selection, setSelection] = useState<KartelaSelection>(null);

  const refreshKey =
    tab === "dispatches"
      ? "kartela-dispatches"
      : tab === "receipts"
        ? "kartela-receipts"
        : tab === "rolls"
          ? "rolls:KARTELA_SENT"
          : "swatches";

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Kartela"
        description="Kartela sevk/kabul belgeleri, fasondaki toplar ve üretilen kartelalar — tek yerden."
        actions={<RefreshButton queryKey={refreshKey} extraKeys={[["kartela"]]} />}
      />
      <KartelaTabBar tab={tab} onTab={setTab} />

      {tab === "dispatches" ? (
        <DispatchesTab onSelect={setSelection} />
      ) : tab === "receipts" ? (
        <ReceiptsTab onSelect={setSelection} />
      ) : tab === "rolls" ? (
        <RollsTable tab="KARTELA_SENT" />
      ) : (
        <SwatchesPanel />
      )}

      <KartelaDetailSheet selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}

function DispatchesTab({ onSelect }: { onSelect: (s: KartelaSelection) => void }) {
  const { table, query, search, setSearch, pagination } = useDataTable<KartelaDispatchListItem>({
    queryKey: "kartela-dispatches",
    fetchFn: kartelaService.listDispatchesCursor,
    columns: kartelaDispatchColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });

  return (
    <>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Belge no / firma ara..."
      />
      <FilterBar filters={DISPATCH_FILTERS} />
      <DataTable<KartelaDispatchListItem>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Kartela sevki bulunamadı."
        onRowClick={(d) => onSelect({ kind: "dispatch", id: d.id })}
      />
    </>
  );
}

function ReceiptsTab({ onSelect }: { onSelect: (s: KartelaSelection) => void }) {
  const { table, query, search, setSearch, pagination } = useDataTable<KartelaReceiptListItem>({
    queryKey: "kartela-receipts",
    fetchFn: kartelaService.listReceiptsCursor,
    columns: kartelaReceiptColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });

  return (
    <>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Belge no / irsaliye / firma ara..."
      />
      <FilterBar filters={RECEIPT_FILTERS} />
      <DataTable<KartelaReceiptListItem>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Kartela kabulü bulunamadı."
        onRowClick={(r) => onSelect({ kind: "receipt", id: r.id })}
      />
    </>
  );
}
