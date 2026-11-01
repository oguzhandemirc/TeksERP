// Gelen belge listesi — Kumaş Stoğu ile aynı ortak DataTable (tam genişlik, yapışkan başlık, seçim çubuğu,
// sonsuz kaydırma + durum altlığı). Satır tıkı detaya gider; sağ tık: Aç / Sil (taslak değilse pasif + neden).
// Toplu ve tekil "Sil" AYNI önizleme → onay akışına (BulkDeleteNotesDialog) gider; ayrı silme yolu yok.
import { useState } from "react";
import type { Table } from "@tanstack/react-table";
import { Trash2 } from "lucide-react";
import { DataTable } from "@/components/data-table/DataTable";
import { CopyMenuItem, RowOpenItems } from "@/components/data-table/row-menu-items";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import type { DataTablePagination } from "@/hooks/useDataTable";
import { BulkDeleteNotesDialog } from "./BulkDeleteNotesDialog";
import { DELETE_BLOCK_HINT, isDeletable } from "./noteStatus";
import type { DeliveryNoteHeader } from "./types";

interface Props {
  table: Table<DeliveryNoteHeader>;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  pagination: DataTablePagination;
  /** Detay yolu (satır tıkı + sağ tık "Aç"). */
  pathOf: (id: string) => string;
  onOpen: (id: string) => void;
  /** `gelen-belge:write` — seçim kutuları, "Seçilenleri sil" ve sağ tık "Sil". */
  canDelete: boolean;
}

const blockedReason = (r: DeliveryNoteHeader) => DELETE_BLOCK_HINT[r.status];

function DeleteMenuItem({ note, onDelete }: { note: DeliveryNoteHeader; onDelete: (ids: string[]) => void }) {
  const hint = DELETE_BLOCK_HINT[note.status];
  if (hint) {
    return (
      <ContextMenuItem disabled title={hint} data-testid="note-menu-delete">
        <Trash2 />
        <span className="flex flex-col">
          Sil<span className="text-xs text-muted-foreground">{hint}</span>
        </span>
      </ContextMenuItem>
    );
  }
  return (
    <ContextMenuItem className="text-destructive" onSelect={() => onDelete([note.id])} data-testid="note-menu-delete">
      <Trash2 /> Sil
    </ContextMenuItem>
  );
}

export function NoteListTable({ table, isLoading, isError, onRetry, pagination, pathOf, onOpen, canDelete }: Props) {
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  return (
    <>
      <DataTable<DeliveryNoteHeader>
        table={table}
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        errorText="Gelen belge listesi alınamadı; bu bir “belge yok” cevabı değildir."
        pagination={pagination}
        emptyText="Bu süzgece uyan gelen belge yok. Tabletten irsaliye fotoğrafı çekin, “Belge yükle” ile dosya seçin ya da “Elle taslak” açın."
        exportName="Gelen Belgeler"
        selectionHint="Silmek için taslakları işaretleyin; onaylı belge seçilemez."
        selectionBlockedReason={canDelete ? blockedReason : undefined}
        onRowClick={(r) => onOpen(r.id)}
        bulkActions={
          canDelete
            ? (rows) => (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 gap-1.5"
                  disabled={rows.filter((r) => isDeletable(r.status)).length === 0}
                  onClick={() => setDeleteIds(rows.filter((r) => isDeletable(r.status)).map((r) => r.id))}
                  data-testid="notes-bulk-delete"
                >
                  <Trash2 className="h-4 w-4" /> Seçilenleri sil
                </Button>
              )
            : undefined
        }
        rowContextMenu={(note) => (
          <>
            <RowOpenItems path={pathOf(note.id)} openLabel="Aç" />
            {canDelete && (
              <>
                <ContextMenuSeparator />
                <DeleteMenuItem note={note} onDelete={setDeleteIds} />
              </>
            )}
            <ContextMenuSeparator />
            <CopyMenuItem label="Belge no" value={note.noteNo} />
          </>
        )}
      />
      <BulkDeleteNotesDialog ids={deleteIds} onOpenChange={(o) => !o && setDeleteIds(null)} onDone={() => table.resetRowSelection()} />
    </>
  );
}
