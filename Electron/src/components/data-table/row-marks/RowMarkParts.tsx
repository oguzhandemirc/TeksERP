import { Check, Eraser, StickyNote } from "lucide-react";
import { ContextMenuItem, ContextMenuLabel } from "@/components/ui/context-menu";
import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ROW_MARK_COLORS, type RowMarkColor, type RowMarkInput } from "@/services/rowMarkService";
import { ROW_MARK_COLOR_META } from "./colors";
import { primaryMark, type RowMarkEntry } from "./useRowMarks";

/** Satır işaret özelliğinin satıra inen kısmı — DataTable bunu satır başına verir. */
export interface RowMarkRowProps {
  recordId: string;
  entry: RowMarkEntry | undefined;
  onSet: (recordId: string, patch: Partial<RowMarkInput>) => void;
  onEditNote: (recordId: string) => void;
}

export function RowMarkHeadCell() {
  return <TableHead className="w-2 px-0" aria-label="İşaret" />;
}

/** Sol kenar şeridi (renk) + not simgesi; işaretsiz satırda boş ince hücre (hiza korunur). */
export function RowMarkGutter({ entry }: { entry: RowMarkEntry | undefined }) {
  const mark = primaryMark(entry);
  const hasNote = Boolean(entry?.mine?.note || entry?.shared.some((m) => m.note));
  return (
    <TableCell className="relative w-2 px-0" data-row-mark={mark?.color ?? (hasNote ? "NOTE" : undefined)}>
      {mark?.color ? <span aria-hidden className={cn("absolute inset-y-0.5 left-0 w-1 rounded-r", ROW_MARK_COLOR_META[mark.color].stripe)} /> : null}
      {hasNote ? <StickyNote aria-label="Not var" className="relative ml-1.5 h-3 w-3 text-muted-foreground" /> : null}
    </TableCell>
  );
}

/** Sağ tık menüsünün işaret bölümü: beş renk + kaldır + not. Mevcut satır menüsü ayraçla altına gelir. */
export function RowMarkMenuItems({ recordId, entry, onSet, onEditNote }: RowMarkRowProps) {
  const current: RowMarkColor | null = entry?.mine?.color ?? null;
  const note = entry?.mine?.note ?? null;
  return (
    <>
      <ContextMenuLabel className="text-xs text-muted-foreground">İşaret (kişisel)</ContextMenuLabel>
      {ROW_MARK_COLORS.map((c) => (
        <ContextMenuItem key={c} onSelect={() => onSet(recordId, { color: c })}>
          <span aria-hidden className={cn("h-3 w-3 rounded-full", ROW_MARK_COLOR_META[c].swatch)} />
          {ROW_MARK_COLOR_META[c].label}
          {current === c ? <Check className="ml-auto" aria-label="seçili" /> : null}
        </ContextMenuItem>
      ))}
      {current ? (
        <ContextMenuItem onSelect={() => onSet(recordId, { color: null })}>
          <Eraser /> İşareti kaldır
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem onSelect={() => onEditNote(recordId)}>
        <StickyNote /> {note ? "Notu düzenle…" : "Not ekle…"}
      </ContextMenuItem>
    </>
  );
}
