import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { cn } from "@/lib/utils";
import { customerService } from "@/pages/Customers/service";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { returnColumns } from "./returnsColumns";
import { returnsService, type ReturnRow, type ReturnsCursorResponse } from "./service";
import { ReturnsDetailSheet } from "./ReturnsDetailSheet";
import { ReturnEntryDialog } from "./ReturnEntryDialog";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

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
  const [entryOpen, setEntryOpen] = useState(false);
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="İade Takibi"
        description="Müşteriden dönen toplar — hangi siparişten, hangi üründen, ne kadar."
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
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Neden / not içinde ara..."
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
      />
      <ReturnsDetailSheet row={selected} onClose={() => setSelected(null)} />
      <ReturnEntryDialog open={entryOpen} onOpenChange={setEntryOpen} />
    </div>
  );
}
