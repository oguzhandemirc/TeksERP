import { flexRender, type Header, type Table as TanstackTable } from "@tanstack/react-table";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Download, GripVertical, Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { exportTableToCsv } from "@/lib/table-export";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

interface Props<T> {
  table: TanstackTable<T>;
  isLoading?: boolean;
  pagination?: Pagination;
  emptyText?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T>({
  table,
  isLoading,
  pagination,
  emptyText = "Kayıt yok.",
  onRowClick,
}: Props<T>) {
  const rows = table.getRowModel().rows;
  const selectable = Boolean(table.options.enableRowSelection);
  const selected = table.getSelectedRowModel().rows;
  // 8px eşik: küçük hareketler sürükleme değil → başlık sıralama tıklaması bozulmaz.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = table.getState().columnOrder?.length
      ? table.getState().columnOrder
      : table.getAllLeafColumns().map((c) => c.id);
    const oldIndex = current.indexOf(active.id as string);
    const newIndex = current.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    table.setColumnOrder(arrayMove(current, oldIndex, newIndex));
  };

  const colCount = table.getAllColumns().length + (selectable ? 1 : 0);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card [&_tr]:border-b-2 [&_tr]:border-primary/30">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {selectable && (
                    <TableHead className="w-9">
                      <Checkbox
                        checked={
                          table.getIsAllPageRowsSelected()
                            ? true
                            : table.getIsSomePageRowsSelected()
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
                        aria-label="Tümünü seç"
                      />
                    </TableHead>
                  )}
                  <SortableContext
                    items={hg.headers.map((h) => h.column.id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    {hg.headers.map((h) => (
                      <SortableHead key={h.id} header={h} />
                    ))}
                  </SortableContext>
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading && rows.length === 0
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      {selectable && (
                        <TableCell className="w-9">
                          <Skeleton className="h-4 w-4" />
                        </TableCell>
                      )}
                      {table.getAllColumns().map((c) => (
                        <TableCell key={c.id}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : rows.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={colCount} className="h-48">
                          <EmptyState icon={Inbox} title={emptyText} />
                        </TableCell>
                      </TableRow>
                    )
                  : rows.map((row, i) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() ? "selected" : undefined}
                        className={cn("row-enter", onRowClick && "cursor-pointer")}
                        style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                        onClick={() => onRowClick?.(row.original)}
                      >
                        {selectable && (
                          <TableCell className="w-9" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={row.getIsSelected()}
                              onCheckedChange={(v) => row.toggleSelected(!!v)}
                              aria-label="Seç"
                            />
                          </TableCell>
                        )}
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {selected.length > 0 && (
        <div className="flex items-center gap-3 border-t bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.length} seçili</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => exportTableToCsv(table, "secili-kayitlar", selected)}
            >
              <Download className="h-3.5 w-3.5" />
              CSV indir
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => table.resetRowSelection()}>
              Seçimi temizle
            </Button>
          </div>
        </div>
      )}

      {pagination ? <DataTablePagination pagination={pagination} /> : null}
    </div>
  );
}

function SortableHead<T>({ header }: { header: Header<T, unknown> }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: header.column.id,
  });
  const sized = header.getSize();
  return (
    <TableHead
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        width: sized === 150 ? undefined : sized,
        opacity: isDragging ? 0.65 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
      className="group/th relative cursor-grab touch-none select-none active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      {!header.isPlaceholder && (
        <GripVertical
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40 opacity-0 transition-opacity group-hover/th:opacity-100"
        />
      )}
      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
    </TableHead>
  );
}
