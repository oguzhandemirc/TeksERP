import { flexRender, type ColumnMeta, type Header, type Table as TanstackTable } from "@tanstack/react-table";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { columnLabel } from "@/lib/table-export";
import { ColumnResizeHandle, clipStyle } from "./column-layout";

/** Sayısal kolon (meta.align "right" ya da toplanabilir) sağa hizalı + sabit genişlikli rakam. */
export function alignClass(meta: Pick<ColumnMeta<never, unknown>, "align" | "summable"> | undefined): string | undefined {
  const align = meta?.align ?? (meta?.summable ? "right" : undefined);
  return align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : undefined;
}

/** Başlık hücresi: tut-sürükle → sütun yeri (dnd-kit), sağ kenar → genişlik. */
export function SortableHead<T>({ header, table }: { header: Header<T, unknown>; table: TanstackTable<T> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: header.column.id,
  });
  return (
    <TableHead
      ref={setNodeRef}
      data-col={header.column.id}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={cn("group/th relative cursor-grab touch-none select-none whitespace-nowrap active:cursor-grabbing", alignClass(header.column.columnDef.meta))}
      {...attributes}
      {...listeners}
    >
      {!header.isPlaceholder && (
        <GripVertical
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40 opacity-0 transition-opacity group-hover/th:opacity-100"
        />
      )}
      {header.isPlaceholder ? null : (
        <div data-cell-clip={header.column.id} className="truncate" style={clipStyle(header.column.id, false)}>
          {flexRender(header.column.columnDef.header, header.getContext())}
        </div>
      )}
      {!header.isPlaceholder && (
        <ColumnResizeHandle table={table} columnId={header.column.id} label={columnLabel(header.column)} />
      )}
    </TableHead>
  );
}
