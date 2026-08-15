import { memo, useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { flexRender, type ColumnDef, type Header, type Row, type Table as TanstackTable } from "@tanstack/react-table";
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
import {
  AlertOctagon,
  Copy,
  FileText,
  FileSpreadsheet,
  GripVertical,
  Inbox,
  Info,
  RefreshCw,
  X,
} from "lucide-react";
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
import { exportTableToPdf, exportTableToXlsx, exportListName } from "@/lib/table-export";
import { cn } from "@/lib/utils";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { DataTablePagination } from "./DataTablePagination";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";

// Satır açılışı bu kadar geciktirilir; bu süre içinde 2. tık gelirse (çift-tık)
// açılış iptal edilir. Çift-tıkla kelime seçerken satır detayı açılmasın diye.
// Daha düşük = daha çevik tek-tık ama çok hızlı çift-tıkları kaçırma riski artar.
const ROW_OPEN_DELAY_MS = 160;

interface Props<T> {
  table: TanstackTable<T>;
  isLoading?: boolean;
  /**
   * Liste sorgusu DÜŞTÜ. Verilirse "Kayıt bulunamadı." YERİNE hata satırı çizilir.
   *
   * ⚠️ BU AYRIM ZORUNLU: hata anında `rows` boş kalır ve boş-durum metnini basmak
   * OLUMLU bir iddiadır — "böyle bir kayıt yok". Kullanıcı kaydın silindiğini
   * sanıp ikinci kez tanımlar (mükerrer depo / cari / kasa). İstek düştüğünde
   * ekranda kalan tek metin doğruyu söylemek zorundadır; interceptor toast'ı
   * saniyelerde kaybolur. Emsal: `Reports/Finance/ReportErrorCard`.
   */
  isError?: boolean;
  /** Verilirse hata satırında "Tekrar dene" çıkar. İş yapmayan düğme konmaz. */
  onRetry?: () => void;
  /** Hata satırının açıklama cümlesi — verilmezse bağlamsız ortak cümle. */
  errorText?: string;
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
  /** Seçili satır indirmelerinin dosya adı tabanı (ör. "Sevkiyatlar"). Tarih otomatik. */
  exportName?: string;
  /**
   * "Seçili PDF/Excel" tuşlarına tooltip. Bu iki tuş EKRANDAKİ SATIRLARI indirir;
   * sayfa aynı çubuğa başka bir export menüsü koyuyorsa (ör. çuval "İçerik Dökümü")
   * ayrımı burada yaz — etiketler kısa olmak zorunda, ipucu hover'da netleştirir.
   */
  selectedExportHint?: string;
  /**
   * Satıra sağ-tık menüsü. Dönen düğümler `ContextMenuContent` içine yerleşir
   * (örn. `ContextMenuItem` / `RowOpenItems`). `null` dönerse o satır menüsüz kalır.
   */
  rowContextMenu?: (row: T) => ReactNode;
  /** Sayfalama çubuğunun sağına (kalıcı görünür) eklenen aksiyonlar — ör. "Tümünü
   *  İndir" + "Envanter Özeti". pagination verilmezse gösterilmez. */
  paginationActions?: ReactNode;
}

export function DataTable<T>({
  table,
  isLoading,
  isError,
  onRetry,
  errorText,
  pagination,
  emptyText = "Kayıt yok.",
  onRowClick,
  bulkActions,
  selectionHint = "Toplu işlem için satırları seçin.",
  exportName = "Liste",
  selectedExportHint,
  rowContextMenu,
  paginationActions,
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

  // DataTableRow memo geçersizleştirme sinyalleri — bunlar OLMADAN memo satır
  // gövdesini fazla iyi tutar: sütun görünürlük/sıra veya sütun TANIMI değişince
  // (row referansı table-core'da yalnız [data]'ya bağlı olduğundan) satır
  // yeniden render OLMAZ → başlık güncellenir ama gövde bayat kalır (hizasızlık /
  // gizlenen sütun gövdede kalır / CrudPage aksiyon hücresi bayat). visibleColumnIds
  // görünürlük+sırayı, columnDefs ise hücre-closure (ör. restoreMutation.isPending)
  // değişimini yakalar. İkisi de satır SEÇİMİ toggle'ında sabit → memo hâlâ tutar.
  const visibleColumnIds = table.getVisibleLeafColumns().map((c) => c.id).join(",");
  const columnDefs = table.options.columns;

  // Sonsuz kaydırma: liste dibine gelince pagination.loadMore otomatik tetiklenir
  // ("Daha Fazla Yükle" butonu kaldırıldı). rootRef = kaydırma kapsayıcısı,
  // sentinelRef = tablonun sonundaki görünmez eleman.
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: pagination?.hasMore ?? false,
    isLoading: pagination?.isFetchingMore ?? false,
    onLoadMore: pagination?.loadMore ?? (() => {}),
    enabled: Boolean(pagination),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={rootRef} className="flex-1 overflow-auto">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          {/* containerClassName="overflow-visible": Table'ın kendi overflow-auto
              sarmalayıcısı sticky başlığı yutuyordu (thead dış scroll kabına değil
              iç sarmalayıcıya yapışıp dikeyde kayıyordu). overflow-visible ile
              tek scroll kabı = rootRef → başlık gerçekten sabit kalır. */}
          <Table containerClassName="overflow-visible">
            {/* Mor ayraç çizgisi: <tr> border-b'si `border-collapse: collapse`'te
                sticky başlıkla YAPIŞMAZ (çökmüş kenarlık gövdeyle boyanıp kayar).
                Çözüm: çizgiyi th hücrelerinin ARKA PLANINA linear-gradient olarak
                koy (alt 2px mor, üstü şeffaf) — arka plan çökmüş hücrelerde daima
                render olur ve th sticky başlıkla birlikte kaydıkça sabit kalır. */}
            <TableHeader className="sticky top-0 z-10 bg-card [&_th]:bg-[linear-gradient(to_top,hsl(var(--primary)_/_0.3)_2px,transparent_2px)]">
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
              {/* İKİNCİ KATMAN — hata VAR ama elde (bayat) satır de var: liste
                  gizlenmez, üstüne "tazelenemedi" bandı konur. Kalıp
                  `PeriodClose/CashPeriodSection`ten alındı. */}
              {isError && rows.length > 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount} className="bg-amber-100 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    <span className="flex items-center gap-2">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      Liste tazelenemedi — aşağıdaki satırlar son başarılı okumaya aittir ve eski
                      olabilir.
                      {onRetry ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="ml-1 h-6 px-2 text-xs"
                          onClick={onRetry}
                        >
                          Tekrar dene
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              )}
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
                : /* ⚠️ HATA SATIRI BOŞ DURUMUN ÖNÜNDE — sıra load-bearing:
                     altta kalsaydı hata anında yine "Kayıt bulunamadı." basılırdı
                     ve düzeltmenin tamamı boşa düşerdi (ReportErrorCard emsali). */
                  isError && rows.length === 0
                  ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={colCount} className="h-48">
                          <div className="mx-auto flex max-w-md items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
                            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                            <div className="min-w-0 flex-1 text-left">
                              <p className="font-semibold text-destructive">Liste yüklenemedi</p>
                              <p className="mt-1 text-muted-foreground">
                                {errorText ??
                                  "İstek sunucuya ulaşamadı ya da reddedildi."}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Bu <strong>“kayıt yok”</strong> anlamına GELMEZ — kayıtlarınız
                                yerinde duruyor. Yeni kayıt eklemeden önce tekrar deneyin.
                              </p>
                              {onRetry ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="mt-3 h-7 px-2 text-xs"
                                  onClick={onRetry}
                                >
                                  <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                  Tekrar dene
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  : rows.length === 0
                  ? (
                      <TableRow>
                        <TableCell colSpan={colCount} className="h-48">
                          <EmptyState icon={Inbox} title={emptyText} />
                        </TableCell>
                      </TableRow>
                    )
                  : rows.map((row, i) => (
                      <DataTableRow<T>
                        key={row.id}
                        row={row}
                        index={i}
                        isSelected={row.getIsSelected()}
                        selectable={selectable}
                        onRowClick={onRowClick}
                        rowContextMenu={rowContextMenu}
                        openTimer={openTimer}
                        selRef={selRef}
                        visibleColumnIds={visibleColumnIds}
                        columnDefs={columnDefs}
                      />
                    ))}
            </TableBody>
          </Table>
        </DndContext>
        {/* Sonsuz kaydırma sentinel'i — görünür olunca sonraki sayfa otomatik yüklenir. */}
        {pagination ? <div ref={sentinelRef} aria-hidden className="h-px w-full shrink-0" /> : null}
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
                title={selectedExportHint}
                onClick={() =>
                  void exportTableToPdf(
                    table,
                    selected.map((r) => r.original),
                    exportListName(exportName, { selected: true }),
                  )
                }
              >
                <FileText className="h-3.5 w-3.5 text-destructive" />
                Seçili PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                title={selectedExportHint}
                onClick={() =>
                  void exportTableToXlsx(
                    table,
                    selected.map((r) => r.original),
                    exportListName(exportName, { selected: true }),
                  )
                }
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-success" />
                Seçili Excel
              </Button>
            </>
          ) : (
            <>
              {selectionHint ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  {selectionHint}
                </span>
              ) : null}
              {bulkActions ? <div className="ml-auto">{bulkActions([])}</div> : null}
            </>
          )}
        </div>
      )}

      {pagination ? <DataTablePagination pagination={pagination} actions={paginationActions} /> : null}
    </div>
  );
}

interface DataTableRowProps<T> {
  row: Row<T>;
  index: number;
  isSelected: boolean;
  selectable: boolean;
  onRowClick?: (row: T) => void;
  rowContextMenu?: (row: T) => ReactNode;
  openTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  selRef: MutableRefObject<string>;
  // Memo geçersizleştirme sinyalleri — gövdede doğrudan kullanılmaz, React.memo
  // shallow karşılaştırması görür. Sütun görünürlük/sıra (visibleColumnIds) veya
  // sütun tanımı (columnDefs) değişince satır yeniden render olur; salt seçim
  // toggle'ında ikisi de sabit → memo tutar. (Bkz. DataTable gövdesindeki not.)
  visibleColumnIds: string;
  columnDefs: ColumnDef<T>[];
}

/**
 * Perf: tek satır ayrı React.memo'lu bileşen. Bir satırın seçimi değişince
 * (setRowSelection → tablo re-render) TÜM satırlar (her hücre flexRender + varsa
 * per-row Radix ContextMenu) yeniden render oluyordu. react-table satır
 * referansı `data` değişmedikçe kararlı; `isSelected` prop olarak verildiğinden
 * yalnız toggle edilen satır re-render eder, gerisi memo ile atlanır. Satır
 * handler'ı olmayan sayfalarda (CrudPage master-data) memo tamamen tutar.
 */
function DataTableRowInner<T>({
  row,
  index,
  isSelected,
  selectable,
  onRowClick,
  rowContextMenu,
  openTimer,
  selRef,
}: DataTableRowProps<T>) {
  const rowEl = (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      className={cn("row-enter", onRowClick && "cursor-pointer")}
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
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
          {/* Seçilemez satırlarda (enableRowSelection predicate false —
              ör. sevkteki çuval) checkbox gizlenir; boş hücre hizayı korur. */}
          {row.getCanSelect() && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              aria-label="Seç"
            />
          )}
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
    <ContextMenu>
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
}

// memo + generic korunumu: memo default shallow karşılaştırması props için yeterli
// (row/refs kararlı, isSelected/index/selectable primitive).
const DataTableRow = memo(DataTableRowInner) as typeof DataTableRowInner;

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
