import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Printer, PanelRight } from "lucide-react";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { PrintedDocDialog } from "@/components/print/PrintedDocDialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { ScanField } from "@/components/scanner/ScanField";
import { cn } from "@/lib/utils";
import { customerService } from "@/pages/Customers/service";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { returnColumns } from "./returnsColumns";
import { returnsService, type ReturnRow, type ReturnsCursorResponse } from "./service";
import { ReturnsDetailSheet } from "./ReturnsDetailSheet";
import { ReturnEntryDialog } from "./ReturnEntryDialog";

const DEC = new Intl.NumberFormat("tr-TR", { useGrouping: false, maximumFractionDigits: 1 });

const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  { kind: "lookup", key: "reasonId", label: "Neden", service: returnReasonService, queryKey: "return-reasons" },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt" },
];

// İptal durumu segment kontrolü. `filter[cancelled]` URL param'ı → useDataTable
// → backend listReturns. Default "active" (param yok); iptal edilenler ayrı görünür.
const STATUS_OPTIONS = [
  { value: "active", label: "Aktif" },
  { value: "cancelled", label: "İptal Edilenler" },
  { value: "all", label: "Hepsi" },
] as const;

function ReturnsStatusFilter() {
  const [sp, setSp] = useSearchParams();
  const current = sp.get("filter[cancelled]") ?? "active";
  const set = (value: string) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === "active") next.delete("filter[cancelled]");
        else next.set("filter[cancelled]", value);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border p-0.5">
      {STATUS_OPTIONS.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="sm"
          variant={current === o.value ? "secondary" : "ghost"}
          className={cn("h-6 px-2 text-xs", current !== o.value && "text-muted-foreground")}
          onClick={() => set(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export function ReturnsPage() {
  const [selected, setSelected] = useState<ReturnRow | null>(null);
  const [docReturn, setDocReturn] = useState<ReturnRow | null>(null);
  const [entryOpen, setEntryOpen] = useState(false);
  const [scanBarcode, setScanBarcode] = useState("");
  const [scanSeed, setScanSeed] = useState<string | undefined>(undefined);

  // Tabanca: sevk edilmiş top okut → İade Girişi'ni o barkodla aç (oto-sorgu).
  const startReturnScan = (code: string) => {
    setScanSeed(code);
    setEntryOpen(true);
    setScanBarcode("");
  };
  const { table, query, search, setSearch, pagination } = useDataTable<ReturnRow>({
    queryKey: "returns",
    fetchFn: returnsService.listCursor,
    columns: returnColumns,
    defaultPageSize: 50,
    enableSelection: false,
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
      <PermissionGate permission="return:write">
        <ScanField
          className="border-b px-4 py-2"
          widthClassName="max-w-xs"
          value={scanBarcode}
          onChange={setScanBarcode}
          onScan={startReturnScan}
          placeholder="Sevk edilmiş top barkodu okut → iade gir"
          expectPrefix="ROLL"
          submitLabel="İade Gir"
        />
      </PermissionGate>
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Müşteri, sipariş, kumaş, barkod veya neden ara..."
      />
      <FilterBar filters={FILTERS} leading={<ReturnsStatusFilter />} />
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
      <ReturnsDetailSheet row={selected} onClose={() => setSelected(null)} />
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
