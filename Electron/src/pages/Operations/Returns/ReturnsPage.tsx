import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Plus, Printer, PanelRight } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { SavedViewsMenu } from "@/components/data-table/SavedViewsMenu";
import { useDataTable } from "@/hooks/useDataTable";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode } from "@/lib/scanner/barcode-kind";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { returnColumns } from "./returnsColumns";
import { returnsService, type ReturnRow, type ReturnsCursorResponse } from "./service";
import { ReturnsDetailSheet } from "./ReturnsDetailSheet";
import { ReturnEntryDialog } from "./ReturnEntryDialog";
import { ReturnInvoiceDraft } from "./ReturnInvoiceDraft";
import { canDraftReturnInvoice } from "./returnInvoice";
import { useFeatureFlags } from "@/hooks/usePricingEnabled";
import { ReturnsFilterRow, RETURN_PERSIST } from "./ReturnsFilterRow";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

export function ReturnsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ReturnRow | null>(null);
  const [docReturn, setDocReturn] = useState<ReturnRow | null>(null);
  // İÇ fatura taslağı — yalnız TİCARET REJİMİNDE. Fabrikada ön muhasebe modülü
  // kapalı olduğu için düğme hiç çizilmez (fabrika sıfır-fark; sevkiyat emsali).
  const financeEnabled = useFeatureFlags().data?.data?.financeEnabled ?? false;
  const [invoiceFor, setInvoiceFor] = useState<ReturnRow | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [scanSeed, setScanSeed] = useState<string | undefined>(undefined);

  // Tabanca: sevk edilmiş top okut → İade Girişi'ni o barkodla aç (oto-sorgu).
  const startReturnScan = (code: string) => {
    setScanSeed(code);
    setEntryOpen(true);
  };
  // İade yazma izni yoksa okutulan kod pencere açmaz, aramaya düşer.
  const canWrite = useRoleAccess().hasPermission("return:write");
  const { table, query, search, setSearch, pagination } = useDataTable<ReturnRow>({
    queryKey: "returns",
    fetchFn: returnsService.listCursor,
    columns: returnColumns,
    defaultPageSize: 50,
    enableSelection: false,
    persistFilters: RETURN_PERSIST,
  });

  // Toplam (filtreli set) — ilk sayfada backend `summary` döndürür.
  const summary = (query.data?.pages?.[0] as ReturnsCursorResponse | undefined)?.summary;

  return (
    <PageShell>
      <PageHeader
        title="İade Takibi"
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate permission="return:write">
              <Button size="sm" onClick={() => setEntryOpen(true)}>
                <Plus className="mr-1 h-4 w-4" />
                Yeni İade
              </Button>
            </PermissionGate>
            <RefreshButton queryKey="returns" />
          </div>
        }
      />
      {/* TEK KUTU (saha 2026-09-22: "iki input kötü"): arama + okutma aynı alanda. Okutulan
          kod top/çuval/sevkiyat kalıbındaysa İade Al penceresi o kodla açılır ve kutu
          temizlenir; değilse metin listeyi süzer (Paketleme ekranıyla aynı kalıp). */}
      <ReturnsFilterRow
        leading={
          <ScanField
            value={search}
            onChange={setSearch}
            onScan={(code) => {
              const kind = classifyBarcode(code).kind;
              if ((kind === "ROLL" || kind === "SACK" || kind === "SHIPMENT") && canWrite) {
                setSearch("");
                startReturnScan(code);
                return;
              }
              setSearch(code);
            }}
            placeholder="Ara ya da kod okut (top · çuval · sevkiyat) → iade gir"
            expectPrefix={["ROLL", "SACK", "SHIPMENT"]}
            className="w-56 min-w-[10rem] shrink 2xl:w-96"
            inputClassName="h-8 text-sm"
            clearable
          />
        }
        trailing={<SavedViewsMenu compact />}
      />
      {summary && summary.count > 0 && (
        <div className="flex gap-6 border-b px-4 py-2 text-sm">
          <span>
            Toplam iade:{" "}
            <span className="font-medium tabular-nums">{summary.count}</span> top
          </span>
          <span>
            Toplam metraj:{" "}
            <span className="font-medium tabular-nums">{DEC.format(summary.totalQty)}</span> m
          </span>
        </div>
      )}
      <DataTable<ReturnRow>
        table={table}
        isLoading={query.isLoading}
        pagination={pagination}
        emptyText="İade kaydı bulunamadı."
        onRowClick={setSelected}
        rowContextMenu={(r) => (
          <>
            <ContextMenuItem onSelect={() => setSelected(r)}>
              <PanelRight /> Detayı aç
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setDocReturn(r)}>
              <Printer /> İade İrsaliyesi
            </ContextMenuItem>
            {/* Faturalanmış / iptal edilmiş grupta ÇIKMAZ — gri satır olmayan bir
                yolu vaat eder (yüklem `canDraftReturnInvoice`). İzin `finance:write`,
                `return:write` DEĞİL: biri iade defterine, diğeri cari deftere yazar. */}
            {canDraftReturnInvoice(r, financeEnabled) && (
              <PermissionGate permission="finance:write">
                <ContextMenuItem onSelect={() => setInvoiceFor(r)}>
                  <FilePlus2 /> Satış İade Faturası
                </ContextMenuItem>
              </PermissionGate>
            )}
          </>
        )}
      />
      {/* Çok kalemli iadede belge GRUP LİDERİNE bağlıdır → satırın kendi id'si değil,
          backend'in türettiği `documentSourceId` kullanılır. */}
      <PrintedDocDialog
        docType="RETURN_DISPATCH"
        sourceId={docReturn?.documentSourceId ?? docReturn?.id ?? null}
        open={Boolean(docReturn)}
        onOpenChange={(o) => !o && setDocReturn(null)}
        title="İade İrsaliyesi"
        description="Müşteriden dönen topun kabul belgesi."
        writePermission="return:write"
      />
      <ReturnsDetailSheet
        row={selected}
        onClose={() => setSelected(null)}
        financeEnabled={financeEnabled}
        onDraftInvoice={setInvoiceFor}
      />
      {/* Taslak diyaloğu TEK yerde mount edilir (sayfa) — detay sheet'i yalnız
          tetikler. İki mount, iki bağımsız durum ve iki farklı ön-dolum demekti. */}
      <ReturnInvoiceDraft
        row={invoiceFor}
        onClose={() => setInvoiceFor(null)}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ["returns"] });
          void qc.invalidateQueries({ queryKey: ["finance"] });
        }}
      />
      <ReturnEntryDialog
        open={entryOpen}
        onOpenChange={(o) => {
          setEntryOpen(o);
          if (!o) setScanSeed(undefined);
        }}
        initialBarcode={scanSeed}
      />
    </PageShell>
  );
}
