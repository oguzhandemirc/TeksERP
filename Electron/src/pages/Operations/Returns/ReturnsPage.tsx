import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { RefreshButton } from "@/components/RefreshButton";
import { DataTable } from "@/components/data-table/DataTable";
import { DataTableToolbar } from "@/components/data-table/DataTableToolbar";
import { FilterBar, type FilterDef } from "@/components/data-table/FilterBar";
import { useDataTable } from "@/hooks/useDataTable";
import { customerService } from "@/pages/Customers/service";
import { returnReasonService } from "@/pages/ReturnReasons/service";
import { returnColumns } from "./returnsColumns";
import { returnsService, type ReturnRow, type ReturnsCursorResponse } from "./service";
import { ReturnsDetailSheet } from "./ReturnsDetailSheet";

const DEC = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

const FILTERS: FilterDef[] = [
  { kind: "lookup", key: "customerId", label: "Müşteri", service: customerService, queryKey: "customers" },
  { kind: "lookup", key: "reasonId", label: "Neden", service: returnReasonService, queryKey: "return-reasons" },
  { kind: "dateRange", label: "Tarih", defaultField: "createdAt" },
];

export function ReturnsPage() {
  const [selected, setSelected] = useState<ReturnRow | null>(null);
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
        actions={<RefreshButton queryKey="returns" />}
      />
      <DataTableToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Neden / not içinde ara..."
      />
      <FilterBar filters={FILTERS} />
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
    </div>
  );
}
