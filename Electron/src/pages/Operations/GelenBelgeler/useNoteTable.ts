// Gelen belge listesinin TanStack tablosu: veri `useNoteList`ten (sunucu süzgeci + cursor + özet AYNEN korunur),
// seçim yalnız silinebilir (DRAFT) satırda ve yalnız `gelen-belge:write` ile; süzgeç değişince seçim sıfırlanır.
import { useEffect, useMemo, useState } from "react";
import { getCoreRowModel, useReactTable, type RowSelectionState, type VisibilityState } from "@tanstack/react-table";
import { cancelDraftColumn, NOTE_COLUMNS } from "./noteColumns";
import { isDeletable } from "./noteStatus";
import type { DeliveryNoteHeader } from "./types";

/** `onCancelDraft` verilirse (ve `canDelete`) DRAFT satırına görünür "Taslağı iptal et" düğmesi eklenir. */
export function useNoteTable(items: DeliveryNoteHeader[], canDelete: boolean, resetKey: string, onCancelDraft?: (id: string) => void) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  useEffect(() => setRowSelection({}), [resetKey]);
  const columns = useMemo(() => (canDelete && onCancelDraft ? [...NOTE_COLUMNS, cancelDraftColumn(onCancelDraft)] : NOTE_COLUMNS), [canDelete, onCancelDraft]);
  return useReactTable({
    data: items,
    columns,
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
