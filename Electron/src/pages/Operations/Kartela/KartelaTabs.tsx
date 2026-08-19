import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
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

// ÇOKLU: birden fazla kartela firmasının sevk/kabullerini tek listede karşılaştır.
// Durum filtresi TEKİL kalır — active/open/received/cancelled/all birbirini
// DIŞLAYAN kapsam anahtarlarıdır (backend if/else zinciri), OR semantiği yok.
const FIRM_FILTER: FilterDef = {
  kind: "multi-lookup",
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

interface TabProps {
  onSelect: (s: KartelaSelection) => void;
  /** Okutulan kod bir kartela (KRT…) ise: liste araması yerine kartela detayını aç. */
  onScanSwatch: (code: string) => void;
  swatchLookupPending: boolean;
}

export function DispatchesTab({ onSelect, onScanSwatch, swatchLookupPending }: TabProps) {
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<KartelaDispatchListItem>({
    queryKey: "kartela-dispatches",
    fetchFn: kartelaService.listDispatchesCursor,
    columns: kartelaDispatchColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });

  // Tek giriş: kartela barkodu (KRT…) → detay sheet; belge no/firma/DISPATCH_DOC
  // kodu (KS…) → liste araması.
  const handleScan = (code: string) => {
    if (classifyBarcode(code).kind === "SWATCH") {
      onScanSwatch(code);
      setSearch("");
      return;
    }
    setSearch(code);
  };

  return (
    <>
      <DataTableToolbar
        fetchAll={fetchAll}
        search={search}
        onSearchChange={setSearch}
        hideSearch
        leading={
          <>
            <ScanField
              value={search}
              onChange={setSearch}
              onScan={handleScan}
              placeholder="Ara ya da barkod okut..."
              expectPrefix={["SWATCH", "DISPATCH_DOC"]}
              busy={swatchLookupPending}
              widthClassName="w-72"
              inputClassName="h-7 text-xs"
              clearable
            />
            <FilterBar filters={DISPATCH_FILTERS} inline />
          </>
        }
      />
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

export function ReceiptsTab({ onSelect, onScanSwatch, swatchLookupPending }: TabProps) {
  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<KartelaReceiptListItem>({
    queryKey: "kartela-receipts",
    fetchFn: kartelaService.listReceiptsCursor,
    columns: kartelaReceiptColumns,
    defaultPageSize: 50,
    enableSelection: false,
  });

  const handleScan = (code: string) => {
    if (classifyBarcode(code).kind === "SWATCH") {
      onScanSwatch(code);
      setSearch("");
      return;
    }
    setSearch(code);
  };

  return (
    <>
      <DataTableToolbar
        fetchAll={fetchAll}
        search={search}
        onSearchChange={setSearch}
        hideSearch
        leading={
          <>
            <ScanField
              value={search}
              onChange={setSearch}
              onScan={handleScan}
              placeholder="Ara ya da barkod okut..."
              expectPrefix={["SWATCH", "DISPATCH_DOC"]}
              busy={swatchLookupPending}
              widthClassName="w-72"
              inputClassName="h-7 text-xs"
              clearable
            />
            <FilterBar filters={RECEIPT_FILTERS} inline />
          </>
        }
      />
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
