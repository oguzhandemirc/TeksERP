import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { subcontractorService } from "@/pages/Subcontractors/service";
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

type Tab = "dispatches" | "receipts";

const TABS: { key: Tab; label: string }[] = [
  { key: "dispatches", label: "Sevkler (gönderilen)" },
  { key: "receipts", label: "Kabuller (gelen)" },
];

/** Görünüm seçici — filtre satırının en başında dropdown olarak yer alır. */
function TabSelect({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <Select value={tab} onValueChange={(v) => onChange(v as Tab)}>
      <SelectTrigger className="h-7 w-auto min-w-[150px] gap-1 text-xs font-medium">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TABS.map((t) => (
          <SelectItem key={t.key} value={t.key}>
            {t.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function KartelaPage() {
  const [tab, setTab] = useState<Tab>("dispatches");
  const [selection, setSelection] = useState<KartelaSelection>(null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Kartela Takibi"
        description="Kartela firmasına gönderilen toplar ve dönen kartelalar."
        actions={<RefreshButton queryKey="kartela" />}
      />

      {/* Aktif sekme dışındaki tablo mount edilmez → tek useDataTable çalışır,
          URL filtre/arama state'i iki sekme arasında paylaşılır. Sekme çubuğu
          arama+filtrenin altında, tablonun hemen üstünde render edilir. */}
      {tab === "dispatches" ? (
        <DispatchesTab tab={tab} onTab={setTab} onSelect={setSelection} />
      ) : (
        <ReceiptsTab tab={tab} onTab={setTab} onSelect={setSelection} />
      )}

      <KartelaDetailSheet selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}

interface TabProps {
  tab: Tab;
  onTab: (t: Tab) => void;
  onSelect: (s: KartelaSelection) => void;
}

function DispatchesTab({ tab, onTab, onSelect }: TabProps) {
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
      <FilterBar filters={DISPATCH_FILTERS} leading={<TabSelect tab={tab} onChange={onTab} />} />
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

function ReceiptsTab({ tab, onTab, onSelect }: TabProps) {
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
      <FilterBar filters={RECEIPT_FILTERS} leading={<TabSelect tab={tab} onChange={onTab} />} />
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
