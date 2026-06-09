import { useEffect, useRef, type ReactNode } from "react";
import { flexRender, type Header, type Table as TanstackTable } from "@tanstack/react-table";
import { toast } from "sonner";
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
import { Copy, Download, GripVertical, Inbox, Info, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyText, getSelectedText } from "@/lib/clipboard";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { exportTableToCsv } from "@/lib/table-export";
import { cn } from "@/lib/utils";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

// Satır açılışı bu kadar geciktirilir; bu süre içinde 2. tık gelirse (çift-tık)
// açılış iptal edilir. Çift-tıkla kelime seçerken satır detayı açılmasın diye.
// Daha düşük = daha çevik tek-tık ama çok hızlı çift-tıkları kaçırma riski artar.
const ROW_OPEN_DELAY_MS = 160;

interface Props<T> {
  table: TanstackTable<T>;
  isLoading?: boolean;
  pagination?: Pagination;
  emptyText?: string;
  onRowClick?: (row: T) => void;
  /** Seçim çubuğuna sayfa-özel toplu aksiyon enjekte eder (seçili satırları alır). */
  bulkActions?: (rows: T[]) => ReactNode;
  /**
   * Hiç satır seçili değilken seçim çubuğunda gösterilen ipucu. Çubuk artık
   * kalıcı: 0 seçimde de görünür ve kullanıcıyı seçime yönlendirir.
   */
  selectionHint?: ReactNode;
  /**
   * Satıra sağ-tık menüsü. Dönen düğümler `ContextMenuContent` içine yerleşir
   * (örn. `ContextMenuItem` / `RowOpenItems`). `null` dönerse o satır menüsüz kalır.
   */
  rowContextMenu?: (row: T) => ReactNode;
}

export function DataTable<T>({
  table,
  isLoading,
  pagination,
  emptyText = "Kayıt yok.",
  onRowClick,
  bulkActions,
  selectionHint = "Toplu işlem için satırları seçin.",
  rowContextMenu,
}: Props<T>) {
  const rows = table.getRowModel().rows;
  const selectable = Boolean(table.options.enableRowSelection);
  const selected = table.getSelectedRowModel().rows;
  // 8px eşik: küçük hareketler sürükleme değil → başlık sıralama tıklaması bozulmaz.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  // Sağ-tık anındaki metin seçimi — satır menüsüne "Seçimi Kopyala" eklemek için.
  const selRef = useRef("");
  // Tek-tık aç / çift-tık seç ayrımı: açılışı kısa süre geciktir, 2. tık
  // gelirse iptal et → kelimeye çift-tıklayıp seçince satır detayı açılmaz.
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current);
  }, []);

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
                  : rows.map((row, i) => {
                      const rowEl = (
                        <TableRow
                          key={row.id}
                          data-state={row.getIsSelected() ? "selected" : undefined}
                          className={cn("row-enter", onRowClick && "cursor-pointer")}
                          style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                          onClick={(e) => {
                            if (!onRowClick) return;
                            // Bekleyen açılışı HER tıkta iptal et — çift-tıkın 2. tıkı
                            // (aşağıdaki guard'lardan erken çıksa bile) 1. tıkın
                            // zamanlayıcısını öldürsün.
                            if (openTimer.current) {
                              clearTimeout(openTimer.current);
                              openTimer.current = null;
                            }
                            // Sürükleyerek/çift-tıkla metin seçildiyse satırı açma.
                            if (window.getSelection()?.toString()) return;
                            // 2./3. tık (çift-tık) → boş hücrede bile açma.
                            if (e.detail > 1) return;
                            const data = row.original;
                            openTimer.current = setTimeout(() => {
                              openTimer.current = null;
                              onRowClick(data);
                            }, ROW_OPEN_DELAY_MS);
                          }}
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
                      );

                      const menu = rowContextMenu?.(row.original);
                      if (!menu) return rowEl;
                      return (
                        <ContextMenu key={row.id}>
                          <ContextMenuTrigger
                            asChild
                            onContextMenu={(e) => {
                              // Sağ-tık anındaki seçimi yakala (menü açılmadan önce).
                              selRef.current = getSelectedText(e.target);
                            }}
                          >
                            {rowEl}
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <SelectionCopyItem getText={() => selRef.current} />
                            {menu}
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
            </TableBody>
          </Table>
        </DndContext>
      </div>

      {/* Seçim çubuğu kalıcı: satır varsa (ve seçim açıksa) hep görünür. 0
          seçimde ipucu + pasif aksiyon; seçim varken temizle (sola, belirgin)
          + aksiyon + CSV. */}
      {selectable && (rows.length > 0 || selected.length > 0) && (
        <div
          className={cn(
            "flex items-center gap-3 border-t px-3 py-2 text-sm",
            selected.length > 0 ? "bg-primary/5" : "bg-muted/40",
          )}
        >
          {selected.length > 0 ? (
            <>
              <span className="font-medium">{selected.length} seçili</span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => table.resetRowSelection()}
              >
                <X className="h-3.5 w-3.5" />
                Seçimi temizle
              </Button>
              {bulkActions?.(selected.map((r) => r.original))}
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-8 gap-1.5"
                onClick={() => exportTableToCsv(table, "secili-kayitlar", selected)}
              >
                <Download className="h-3.5 w-3.5" />
                CSV indir
              </Button>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {selectionHint}
              </span>
              {bulkActions ? <div className="ml-auto">{bulkActions([])}</div> : null}
            </>
          )}
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

/** Satır sağ-tık menüsünün başına "Seçimi Kopyala" — yalnız bir metin seçiliyse.
 *  `getText` menü açılırken yakalanan seçimi okur (selRef). */
function SelectionCopyItem({ getText }: { getText: () => string }) {
  const text = getText();
  if (!text.trim()) return null;
  return (
    <>
      <ContextMenuItem
        onSelect={() => {
          void copyText(text);
          toast.success("Kopyalandı");
        }}
      >
        <Copy /> Seçimi Kopyala
      </ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}
