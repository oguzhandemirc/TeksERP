import { DataTable } from "@/components/data-table/DataTable";
import type { FilterDef } from "@/components/data-table/FilterBar";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { FilterRow } from "@/components/data-table/filter-row/FilterRow";
import { persistConfigOf, splitDefFilters } from "@/components/data-table/filter-row/def-row-filters";
import type { TableFilterPersistConfig } from "@/components/data-table/filter-row/filter-persist";
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

/** Kayıt allowlist'i (Sevkler / Kabuller ayrı anahtar: `kartela-dispatches` · `kartela-receipts`). */
export const DISPATCH_PERSIST: TableFilterPersistConfig = persistConfigOf(DISPATCH_FILTERS);
export const RECEIPT_PERSIST: TableFilterPersistConfig = persistConfigOf(RECEIPT_FILTERS);
const PRIMARY_KEYS = ["status", "subcontractorId"];

interface DocRowProps {
  filters: FilterDef[];
  search: string;
  setSearch: (v: string) => void;
  onScan: (code: string) => void;
  busy: boolean;
}

/** TEK SATIR: `[Ara·okut][Tarih][Durum][Firma] … [Temizle][Kayıtlı]` (araçlar bugünkü gibi). */
function KartelaDocFilterRow(p: DocRowProps) {
  const { primary, more } = splitDefFilters(p.filters, PRIMARY_KEYS);
  return (
    <FilterRow
      leading={
        <ScanField
          value={p.search}
          onChange={p.setSearch}
          onScan={p.onScan}
          placeholder="Ara ya da barkod okut..."
          expectPrefix={["SWATCH", "DISPATCH_DOC"]}
          busy={p.busy}
          className="w-44 min-w-[8rem] shrink 2xl:w-72"
          inputClassName="h-8 text-sm"
          clearable
        />
      }
      primary={primary}
      more={more}
      trailing={<SavedViewsMenu compact />}
    />
  );
}

interface TabProps {
  onSelect: (s: KartelaSelection) => void;
  /** Okutulan kod bir kartela (KRT…) ise: liste araması yerine kartela detayını aç. */
  onScanSwatch: (code: string) => void;
  swatchLookupPending: boolean;
}

export function DispatchesTab({ onSelect, onScanSwatch, swatchLookupPending }: TabProps) {
  const { table, query, search, setSearch, pagination } = useDataTable<KartelaDispatchListItem>({
    queryKey: "kartela-dispatches",
    persistFilters: DISPATCH_PERSIST,
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
      <KartelaDocFilterRow filters={DISPATCH_FILTERS} search={search} setSearch={setSearch} onScan={handleScan} busy={swatchLookupPending} />
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
  const { table, query, search, setSearch, pagination } = useDataTable<KartelaReceiptListItem>({
    queryKey: "kartela-receipts",
    persistFilters: RECEIPT_PERSIST,
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
      <KartelaDocFilterRow filters={RECEIPT_FILTERS} search={search} setSearch={setSearch} onScan={handleScan} busy={swatchLookupPending} />
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
