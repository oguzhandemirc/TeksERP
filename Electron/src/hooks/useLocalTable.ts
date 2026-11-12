import { useMemo, useState } from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useOptionalTablePrefs } from "@/hooks/useTablePrefs";

interface Options<T> {
  /** Kalıcı, benzersiz tablo anahtarı — sütun sırası/görünürlüğü/genişliği bu adla kullanıcı tercihinde durur. */
  tableKey: string;
  data: T[];
  columns: ColumnDef<T>[];
  /** Satır kimliği; verilmezse `row.id`. */
  getRowId?: (row: T, index: number) => string;
  /** Satır seçimi (toplu işlem) — varsayılan KAPALI (veriyi kendi getiren sayfa çoğunlukla seçim çizmez). */
  enableSelection?: boolean | ((row: Row<T>) => boolean);
  initialVisibility?: VisibilityState;
  /** Geçici gizlenen sütunlar (ör. yan panel açıkken daralan liste) — tercihe YAZILMAZ. */
  hiddenColumns?: readonly string[];
}

/**
 * Veriyi sayfanın kendi sorgusundan alan (cursor/süzgeç/sıralama sayfada, SUNUCUDA) liste için ortak DataTable altlığı.
 * Sıralama/süzme/sayfalama tablo içinde YAPILMAZ (manual*) — yalnız sütun düzeni ve seçim burada.
 */
export function useLocalTable<T>({ tableKey, data, columns, getRowId, enableSelection = false, initialVisibility, hiddenColumns }: Options<T>) {
  const prefs = useOptionalTablePrefs(tableKey, initialVisibility);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const hiddenStr = (hiddenColumns ?? []).join(",");
  const columnVisibility = useMemo<VisibilityState>(() => {
    if (!hiddenStr) return prefs.columnVisibility;
    const v = { ...prefs.columnVisibility };
    for (const id of hiddenStr.split(",")) v[id] = false;
    return v;
  }, [prefs.columnVisibility, hiddenStr]);
  return useReactTable({
    data,
    columns,
    state: { columnOrder: prefs.columnOrder, columnVisibility, columnSizing: prefs.columnSizing, rowSelection },
    onColumnOrderChange: prefs.onColumnOrderChange,
    onColumnVisibilityChange: prefs.onColumnVisibilityChange,
    onColumnSizingChange: prefs.onColumnSizingChange,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: enableSelection,
    getRowId: getRowId ?? ((row) => (row as { id: string }).id),
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });
}
