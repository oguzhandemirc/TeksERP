import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar } from "@/components/data-table/FilterBar";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { useDataTable } from "@/hooks/useDataTable";
import { formatNumber } from "@/lib/format";
import { downloadDocsPdf, downloadDocsExcel } from "@/pages/Operations/Shipments/shipmentDocExport";
import { BulkInvoiceAction } from "./BulkInvoiceAction";
import { accountingDispatchService } from "./service";
import { buildDispatchColumns } from "./columns";
import { ACCOUNTING_FILTERS } from "./filters";
import { DispatchReceiptDialog } from "./DispatchReceiptDialog";
import { InvoiceDialog } from "./InvoiceDialog";
import { useAccountingExport } from "./useAccountingExport";
import type { DispatchCursorResponse, DispatchListItem } from "./types";

const QUERY_KEY = "accounting-dispatch";

// Yalnız sevk edilenler (DISPATCHED) — salt-okunur muhasebe görünümü.
const FORCE = { status: "DISPATCHED" } as const;

/**
 * Saha #2 — Muhasebe / Sevk Edilenler. DISPATCHED listesi (sevk tarihi sıralı, tarih +
 * müşteri + şube + yön + fatura + iade filtreli) + sevk fişi (DispatchReceiptDialog) +
 * fatura işareti (InvoiceDialog). Rakamlar BRÜT — iade düşülmez, "N iade" rozeti farkı
 * söyler (bkz. kök CLAUDE.md 2026-08-02).
 *
 * Excel çıkışları:
 *  • "Dönem Excel" — filtreli tüm dönem, tek 5-sayfalık dosya (useAccountingExport).
 *  • Seçim çubuğu — "Birleşik Excel" (işaretliler tek dosyada) + "Belgeler" (her sevk
 *    ayrı PDF/Excel, sevk no adıyla).
 */
export function AccountingDispatchPage() {
  const [receiptFor, setReceiptFor] = useState<DispatchListItem | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<DispatchListItem | null>(null);
  const columns = useMemo(() => buildDispatchColumns(setReceiptFor, setInvoiceFor), []);

  const { table, query, search, setSearch, pagination, fetchAll } = useDataTable<DispatchListItem>({
    queryKey: QUERY_KEY,
    fetchFn: accountingDispatchService.listCursor,
    columns,
    forceFilters: FORCE,
    defaultPageSize: 50,
    // Muhasebe dönemi ÇIKIŞ tarihine göre okunur — createdAt sırası irsaliye
    // sırasıyla uyuşmuyordu (2026-08-02 denetimi).
    defaultSortBy: "dispatchedAt",
    defaultSortOrder: "desc",
    // Toplu seçim: işaretli sevkleri tek dosyada veya belge olarak ayrı ayrı aktar.
    enableSelection: true,
  });

  // Dönem özeti — filtreli KÜMENİN TAMAMI (ilk sayfada gelir; ReturnsPage deseni).
  const summary = (query.data?.pages?.[0] as DispatchCursorResponse | undefined)?.summary;

  const { periodMut, busy, exportSelectedSingle } = useAccountingExport();

  // Seçili sevkiyatların BELGESİ (irsaliye/fiş) — PDF veya Excel, her biri sevk no
  // adıyla; çoklu → klasöre ayrı ayrı. Hepsi DISPATCHED (liste zaten forceFilter'lı).
  const handleDocs = async (fmt: "pdf" | "excel", rows: DispatchListItem[]) => {
    const targets = rows.map((r) => ({
      id: r.id,
      shipmentNo: r.shipmentNo,
      isDirect: r.kind === "DIRECT",
    }));
    const res = fmt === "pdf" ? await downloadDocsPdf(targets) : await downloadDocsExcel(targets);
    if (res.ok) toast.success(`${res.count ?? targets.length} belge indirildi.`);
    else if (res.error) toast.error(res.error);
  };

  return (
    <PageShell>
      <PageHeader
        title="Sevkiyatlar (Muhasebe)"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={periodMut.isPending}
              onClick={() => periodMut.mutate()}
              title="Filtreli dönemin tamamını çok-sayfalı Excel olarak indir (muhasebe formatı)"
            >
              <FileSpreadsheet className="h-4 w-4" /> Dönem Excel
            </Button>
            <RefreshButton queryKey={QUERY_KEY} />
          </div>
        }
      />
      <DataTableToolbar
        fetchAll={fetchAll}
        search={search}
        onSearchChange={setSearch}
        placeholder="Sevkiyat no, sipariş no, firma, plaka, sürücü ara..."
        table={table}
        exportName="Sevkiyatlar (Muhasebe)"
      />
      <FilterBar filters={ACCOUNTING_FILTERS} defaultDateRangeDays={30} />
      {summary && summary.shipmentCount > 0 && (
        <div className="flex gap-6 border-b px-4 py-2 text-sm">
          <span>
            Sevk: <span className="font-medium tabular-nums">{summary.shipmentCount}</span>
          </span>
          <span>
            Toplam metraj:{" "}
            <span className="font-medium tabular-nums">{formatNumber(summary.totalMeters, 1)}</span> m
          </span>
          <span>
            Toplam kg:{" "}
            <span className="font-medium tabular-nums">{formatNumber(summary.totalKg, 1)}</span>
          </span>
          <span className="text-xs text-muted-foreground" title="Sevk anındaki değerler; iade düşülmemiştir">
            (brüt — iade düşülmemiştir)
          </span>
        </div>
      )}
      <DataTable<DispatchListItem>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="Sevk edilmiş sevkiyat bulunamadı."
        exportName="Sevkiyatlar (Muhasebe)"
        selectionHint={null}
        bulkActions={(rows) =>
          rows.length === 0 ? null : (
            <>
              {/* Bu ekran zaten yalnız SEVK EDİLMİŞ kayıtları listeler → ek statü
                  süzmesi gerekmez (backend faturalamayı DISPATCHED'a kilitliyor). */}
              <BulkInvoiceAction
                rows={rows}
                queryKey={QUERY_KEY}
                onDone={() => table.resetRowSelection()}
              />
              <ExportMenu
                label={`Belgeler (${rows.length})`}
                align="start"
                onPdf={() => handleDocs("pdf", rows)}
                onExcel={() => handleDocs("excel", rows)}
              />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={busy !== null}
                onClick={() => exportSelectedSingle(rows.map((r) => r.id))}
                title="Seçili sevkleri TEK birleşik 5-sayfalık Excel'de aktar"
              >
                <FileSpreadsheet className="h-4 w-4" />
                {busy === "single" ? "Hazırlanıyor…" : "Birleşik Excel"}
              </Button>
            </>
          )
        }
      />

      <DispatchReceiptDialog receiptFor={receiptFor} onClose={() => setReceiptFor(null)} />
      <InvoiceDialog row={invoiceFor} onClose={() => setInvoiceFor(null)} queryKey={QUERY_KEY} />
    </PageShell>
  );
}
