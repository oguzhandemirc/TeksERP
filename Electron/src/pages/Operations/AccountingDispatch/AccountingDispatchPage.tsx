import { useMemo } from "react";
import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableTools } from "@/components/data-table/DataTableTools";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { ExportMenu } from "@/components/data-table/ExportMenu";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { useDataTable } from "@/hooks/useDataTable";
import { formatQty } from "@/lib/format";
import { TERIM_AD } from "@/lib/terim";
import { downloadDocsPdf, downloadDocsExcel } from "@/pages/Operations/Shipments/shipmentDocExport";
import { BulkInvoiceAction } from "./BulkInvoiceAction";
import { accountingDispatchService } from "./service";
import { buildDispatchColumns } from "./columns";
import { ACCOUNTING_PERSIST } from "./filters";
import { AccountingFilterRow } from "./AccountingFilterRow";
import { useAccountingExport } from "./useAccountingExport";
import { useDispatchRowActions } from "./useDispatchRowActions";
import type { DispatchCursorResponse, DispatchListItem } from "./types";

const QUERY_KEY = "accounting-dispatch";

// Yalnız sevk edilenler (DISPATCHED) — salt-okunur muhasebe görünümü.
const FORCE = { status: "DISPATCHED" } as const;

/**
 * Saha #2 — Muhasebe / Sevk Edilenler. DISPATCHED listesi (sevk tarihi sıralı, tarih +
 * müşteri + şube + yön + fatura + iade filtreli) + sevk irsaliyesi (ShipmentDocDialog —
 * sevkiyat ekranıyla AYNI yüzey) + fatura bilgisi/belgesi (useDispatchRowActions). Rakamlar BRÜT — iade düşülmez, "N iade" rozeti farkı
 * söyler (bkz. kök CLAUDE.md 2026-08-02).
 *
 * Çıktılar (ortak çıktı diyaloğu — Excel/PDF, sayfa·sütun seçimi):
 *  • "Dönem dökümü" — filtreli tüm dönem, 5 sayfalık muhasebe dökümü (useAccountingExport).
 *  • Seçim çubuğu — "Birleşik döküm" (işaretliler tek dosyada) + "Belgeler" (her sevk
 *    ayrı PDF/Excel, sevk no adıyla).
 */
export function AccountingDispatchPage() {
  // Satır eylemleri (irsaliye · fatura bilgisi · fatura belgesi · ⋯) ve diyalogları — useDispatchRowActions.
  const { handlers, dialogs: rowDialogs } = useDispatchRowActions(QUERY_KEY);
  const columns = useMemo(() => buildDispatchColumns(handlers), [handlers]);
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
    persistFilters: ACCOUNTING_PERSIST,
  });

  // Dönem özeti — filtreli KÜMENİN TAMAMI (ilk sayfada gelir; ReturnsPage deseni).
  const summary = (query.data?.pages?.[0] as DispatchCursorResponse | undefined)?.summary;

  const accountingExport = useAccountingExport();

  // Seçili sevkiyatların BELGESİ (irsaliye/fiş) — PDF veya Excel, her biri sevk no
  // adıyla; çoklu → klasöre ayrı ayrı. Hepsi DISPATCHED (liste zaten forceFilter'lı).
  const handleDocs = async (fmt: "pdf" | "excel", rows: DispatchListItem[]) => {
    const targets = rows.map((r) => ({
      id: r.id,
      shipmentNo: r.shipmentNo,
      isDirect: r.kind === "DIRECT",
    }));
    const res = fmt === "pdf" ? await downloadDocsPdf(targets) : await downloadDocsExcel(targets);
    if (res.ok) toast.success(`${res.count ?? targets.length} belge ${res.printed ? "yazdırma penceresinde açıldı" : "indirildi"}.`);
    else if (res.error) toast.error(res.error);
  };

  return (
    <PageShell>
      <PageHeader
        title={TERIM_AD.sevkEdilenler}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={accountingExport.openPeriod}
              title="Filtreli dönemin tamamı, muhasebe dökümü (Excel ya da PDF; sayfa ve sütun seçilir)"
            >
              <FileSpreadsheet className="h-4 w-4" /> Dönem dökümü
            </Button>
            <RefreshButton queryKey={QUERY_KEY} />
          </div>
        }
      />
      <AccountingFilterRow
        search={search}
        onSearchChange={setSearch}
        trailing={
          <>
            <SavedViewsMenu compact />
            <DataTableTools table={table} exportName={TERIM_AD.sevkEdilenler} fetchAll={fetchAll} compact />
          </>
        }
      />
      {summary && summary.shipmentCount > 0 && (
        <div className="flex gap-6 border-b px-4 py-2 text-sm">
          <span>
            Sevk: <span className="font-medium tabular-nums">{summary.shipmentCount}</span>
          </span>
          <span>
            Toplam metraj:{" "}
            <span className="font-medium tabular-nums">{formatQty(summary.totalMeters)}</span> m
          </span>
          <span>
            Toplam kg:{" "}
            <span className="font-medium tabular-nums">{formatQty(summary.totalKg)}</span>
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
        exportName={TERIM_AD.sevkEdilenler}
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
                onClick={() => accountingExport.openSelected(rows.map((r) => r.id))}
                title="Seçili sevkleri TEK birleşik muhasebe dökümünde aktar (Excel ya da PDF)"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Birleşik döküm
              </Button>
            </>
          )
        }
      />
      {rowDialogs}
      {accountingExport.dialog}
    </PageShell>
  );
}
