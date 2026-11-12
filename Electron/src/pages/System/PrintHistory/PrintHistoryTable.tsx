import { AlertTriangle } from "lucide-react";
import type { Table } from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { printErrorHint } from "@/lib/print-error-hints";
import type { PrintJobRow } from "@/services/printHistoryService";

interface Props {
  table: Table<PrintJobRow>;
  items: PrintJobRow[];
  loading: boolean;
  onSelect: (row: PrintJobRow) => void;
  loadMore: { hasMore: boolean; isFetchingMore: boolean; onLoadMore: () => unknown };
}

const hintOf = (row: PrintJobRow) => (row.status === "HATA" ? printErrorHint(row.errorCode, row.errorMessage) : null);

/** HATA satırının altında her zaman açık neden + ipucu satırı (DataTable `renderSubRow`). */
function ErrorHint({ row }: { row: PrintJobRow }) {
  const hint = hintOf(row);
  if (!hint) return null;
  return (
    <div className="px-4 pb-2 pt-0 text-xs text-red-800 sm:px-6 dark:text-red-200">
      <span className="flex items-start gap-1.5 pl-4">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <span className="font-medium">{hint.neden}</span> {hint.ipucu}
        </span>
      </span>
    </div>
  );
}

/** Yazdırma geçmişi listesi — ortak DataTable; sütunlar `printHistoryColumns.tsx`, Sütunlar menüsü süzgeç çubuğunda. */
export function PrintHistoryTable({ table, items, loading, onSelect, loadMore }: Props) {
  if (loading && items.length === 0) {
    return (
      <div className="space-y-2 p-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12 text-center text-sm text-muted-foreground">
        Süzgece uyan baskı kaydı yok.
      </div>
    );
  }
  return (
    <DataTable
      table={table}
      onRowClick={onSelect}
      rowClassName={(r) => (hintOf(r) ? "bg-red-500/10 hover:bg-red-500/15" : undefined)}
      renderSubRow={(r) => (hintOf(r) ? <ErrorHint row={r} /> : null)}
      loadMore={loadMore}
    />
  );
}
