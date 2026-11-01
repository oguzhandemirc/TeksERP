// Gelen belge listesinin TanStack tablosu: veri `useNoteList`ten (sunucu süzgeci + cursor + özet AYNEN korunur),
// seçim yalnız silinebilir (DRAFT) satırda ve yalnız `gelen-belge:write` ile; süzgeç değişince seçim sıfırlanır.
import { useEffect, useState } from "react";
import { getCoreRowModel, useReactTable, type RowSelectionState, type VisibilityState } from "@tanstack/react-table";
import { NOTE_COLUMNS } from "./noteColumns";
import { isDeletable } from "./noteStatus";
import type { DeliveryNoteHeader } from "./types";

export function useNoteTable(items: DeliveryNoteHeader[], canDelete: boolean, resetKey: string) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  useEffect(() => setRowSelection({}), [resetKey]);
  return useReactTable({
    data: items,
    columns: NOTE_COLUMNS,
    state: { rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: canDelete ? (row) => isDeletable(row.original.status) : false,
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });
}
