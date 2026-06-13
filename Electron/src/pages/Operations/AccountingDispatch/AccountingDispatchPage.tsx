import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Printer, Tags, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { RefreshButton } from "@/components/RefreshButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDataTable } from "@/hooks/useDataTable";
import { customerService } from "@/pages/Customers/service";
import { printDocumentArea, printHtmlString } from "@/lib/print";
import { labelService } from "@/services/labelService";
import { accountingDispatchService } from "./service";
import { buildDispatchColumns } from "./columns";
import { DispatchReceiptDocument } from "./DispatchReceiptDocument";
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
 * Saha #2 — Muhasebe / Sevk Edilenler. Salt-okunur DISPATCHED listesi
 * (tarih + müşteri filtreli) + her sevk için ornek-fis.pdf birebir 3 bölümlü
 * fiş (Ürün / Çuval / Çeki listesi). Fiş printDocumentArea ile basılır.
 */
export function AccountingDispatchPage() {
  const [receiptFor, setReceiptFor] = useState<DispatchListItem | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  const columns = useMemo(() => buildDispatchColumns(setReceiptFor), []);

  const { table, query, search, setSearch, pagination } = useDataTable<DispatchListItem>({
    queryKey: QUERY_KEY,
    fetchFn: accountingDispatchService.listCursor,
    columns,
    forceFilters: FORCE,
    defaultPageSize: 50,
    enableSelection: false,
  });

  const reportQ = useQuery({
    queryKey: ["dispatch-report", receiptFor?.id],
    queryFn: () => accountingDispatchService.getReport(receiptFor!.id),
    enabled: Boolean(receiptFor),
    staleTime: 60_000,
  });
  const report = reportQ.data?.data;

  // Saha #7: toplu etiket — fişteki tüm topların etiketini tek belgede bas.
  const bulkLabelMut = useMutation({
    mutationFn: async () => {
      const rollIds = (report?.cekiRows ?? []).map((c) => c.rollId).filter(Boolean);
      if (rollIds.length === 0) throw new Error("Bu sevkiyatta top yok");
      return labelService.getBulkRollLabelsHtml(rollIds);
    },
    onSuccess: (html) => printHtmlString(html),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sevk Edilenler (Muhasebe)"
        description="Sevki tamamlanmış (DISPATCHED) sevkiyatlar — salt-okunur. 'Fiş' ile ürün/çuval/çeki listesini yazdır."
        actions={<RefreshButton queryKey={QUERY_KEY} />}
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
      />

      <Dialog open={Boolean(receiptFor)} onOpenChange={(o) => !o && setReceiptFor(null)}>
        <DialogContent className="flex h-[90vh] max-w-4xl flex-col">
          <DialogHeader className="flex shrink-0 flex-row items-center justify-between">
            <DialogTitle>Sevk Fişi — {receiptFor?.shipmentNo}</DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!report || bulkLabelMut.isPending}
                onClick={() => bulkLabelMut.mutate()}
              >
                <Tags className="h-4 w-4" /> Toplu Etiket
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!report}
                onClick={() => printDocumentArea(printRef.current)}
              >
                <Printer className="h-4 w-4" /> Yazdır
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setReceiptFor(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-4">
            {reportQ.isLoading ? (
              <Skeleton className="h-96 w-full" />
            ) : report ? (
              <div ref={printRef} className="mx-auto max-w-3xl bg-white p-6 shadow-sm">
                <DispatchReceiptDocument report={report} />
              </div>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">Fiş yüklenemedi.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
