import { useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { useDataTable } from "@/hooks/useDataTable";
import { customerService } from "@/pages/Customers/service";
import { accountingDispatchService } from "./service";
import { buildDispatchColumns } from "./columns";
import { DispatchReceiptDialog } from "./DispatchReceiptDialog";
import { useAccountingExport } from "./useAccountingExport";
import type { DispatchListItem } from "./types";

const QUERY_KEY = "accounting-dispatch";

// Yalnız sevk edilenler (DISPATCHED) — salt-okunur muhasebe görünümü.
const FORCE = { status: "DISPATCHED" } as const;

const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  {
    kind: "dateRange",
    label: "Sevk Tarihi",
    defaultField: "dispatchedAt",
    fieldOptions: [
      { value: "dispatchedAt", label: "Sevk" },
      { value: "createdAt", label: "Oluşturma" },
    ],
  },
];

/**
 * Saha #2 — Muhasebe / Sevk Edilenler. Salt-okunur DISPATCHED listesi (tarih + müşteri
 * filtreli) + sevk fişi (DispatchReceiptDialog). Excel export'ları (useAccountingExport):
 *  • "Excel'e Aktar" — filtreli tüm dönem, tek 5-sayfalık dosya.
 *  • Seçim çubuğu — işaretli sevkler: "Tek Excel" (A) veya "Ayrı Dosyalar" (B, sırayla).
 */
export function AccountingDispatchPage() {
  const [receiptFor, setReceiptFor] = useState<DispatchListItem | null>(null);
  const columns = useMemo(() => buildDispatchColumns(setReceiptFor), []);

  const { table, query, search, setSearch, pagination } = useDataTable<DispatchListItem>({
    queryKey: QUERY_KEY,
    fetchFn: accountingDispatchService.listCursor,
    columns,
    forceFilters: FORCE,
    defaultPageSize: 50,
    // Toplu seçim: işaretli sevkleri tek dosyada (A) veya ayrı dosyalarda (B) aktar.
    enableSelection: true,
  });

  const { periodMut, busy, progress, exportSelectedSingle, exportSelectedSeparate } =
    useAccountingExport();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevk Edilenler (Muhasebe)"
        description="Sevki tamamlanmış (DISPATCHED) sevkiyatlar — salt-okunur. 'Fiş' ile ürün/çuval/çeki listesini yazdır."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={periodMut.isPending}
              onClick={() => periodMut.mutate()}
              title="Filtreli dönemin tamamını çok-sayfalı Excel olarak indir"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel'e Aktar
            </Button>
            <RefreshButton queryKey={QUERY_KEY} />
          </div>
        }
      />
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Sevkiyat no, plaka, sürücü ara..."
        table={table}
        exportName="Sevk Edilenler"
      />
      <FilterBar filters={FILTERS} defaultDateRangeDays={30} />
      <DataTable<DispatchListItem>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sevk edilmiş sevkiyat bulunamadı."
        selectionHint="Tek/ayrı Excel için sevkleri seçin."
        bulkActions={(rows) =>
          rows.length === 0 ? null : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy !== null}
                onClick={() => exportSelectedSingle(rows.map((r) => r.id))}
                title="Seçili sevkleri tek 5-sayfalık Excel'de aktar"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {busy === "single" ? "Hazırlanıyor…" : "Tek Excel"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy !== null}
                onClick={() => exportSelectedSeparate(rows)}
                title="Her seçili sevk için ayrı Excel (sırayla iner)"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {busy === "separate" ? `Ayrı Dosyalar (${progress}/${rows.length})` : "Ayrı Dosyalar"}
              </Button>
            </>
          )
        }
      />

      <DispatchReceiptDialog receiptFor={receiptFor} onClose={() => setReceiptFor(null)} />
    </div>
  );
}
