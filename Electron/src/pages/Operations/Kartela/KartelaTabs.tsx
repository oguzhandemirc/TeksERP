import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { subcontractorService } from "@/pages/Subcontractors/service";
import { kartelaService, type KartelaDispatchListItem, type KartelaReceiptListItem } from "./service";
import { kartelaDispatchColumns, kartelaReceiptColumns } from "./kartelaColumns";
import { type KartelaSelection } from "./KartelaDetailSheet";

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

export function DispatchesTab({ onSelect }: { onSelect: (s: KartelaSelection) => void }) {
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

export function ReceiptsTab({ onSelect }: { onSelect: (s: KartelaSelection) => void }) {
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
