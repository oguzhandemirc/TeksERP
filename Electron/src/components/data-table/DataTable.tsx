import { memo, useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from "react";
import { flexRender, type ColumnDef, type Row, type Table as TanstackTable } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { AlertOctagon, Copy, Inbox, Info, RefreshCw } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { DataTablePagination } from "./DataTablePagination";
import { SortableHead, alignClass } from "./DataTableHead";
import { clipStyle, handleClipHover, tableWidthVars } from "./column-layout";
import { columnCollision, currentOrder, reorderColumns } from "./column-arrange";
import type { DataTablePagination as Pagination } from "@/hooks/useDataTable";
import { SelectionBar } from "./SelectionBar";
import { ExpandHeadCell, ExpandToggleCell, ExpandedRow, expandKey, useRowExpansion, type RowExpandProps } from "./row-expand";

// Satır açılışı bu kadar geciktirilir; bu süre içinde 2. tık gelirse (çift-tık)
// açılış iptal edilir. Çift-tıkla kelime seçerken satır detayı açılmasın diye.
// Daha düşük = daha çevik tek-tık ama çok hızlı çift-tıkları kaçırma riski artar.
const ROW_OPEN_DELAY_MS = 160;
// Hücre içi düğme/bağlantı/alan kendi işini yapar; satır açılışını tetiklemez (stopPropagation unutulsa bile).
const INTERACTIVE = "button, a[href], input, select, textarea, label, [role='button'], [role='checkbox'], [role='menuitem'], [role='switch']";
const fromInteractive = (e: { target: EventTarget; currentTarget: Element }) => {
  const hit = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
  return !!hit && hit !== e.currentTarget && e.currentTarget.contains(hit);
};

/** Satır tıklamasının değiştirici tuşları — `useOpenTarget()(yol, click)` Ctrl/⌘/orta tıkla yeni sekme kararını verir. */
export interface RowClick {
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

interface Props<T> extends RowExpandProps<T> {
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
  /** Satır açılışı; ikinci argüman tıklamanın değiştiricileri (klavye ↑/↓ ile açılışta yok). */
  onRowClick?: (row: T, click?: RowClick) => void;
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
  /**
   * Seçilemez satırın nedeni. Verilir ve metin dönerse kutu GİZLENMEZ, pasif çizilir ve neden
   * ipucu olur (ör. "Onaylanmış belge silinemez"); verilmezse bugünkü gibi boş hücre.
   */
  selectionBlockedReason?: (row: T) => string | null;
  /** Sayfalama çubuğunun sağına (kalıcı görünür) eklenen aksiyonlar — ör. "Tümünü
   *  İndir" + "Envanter Özeti". pagination verilmezse gösterilmez. */
  paginationActions?: ReactNode;
  /** Satıra ek sınıf (ağaç görünümünde bağlam satırı soluk, daraltılan çeşit gizli — Kumaş Özellikleri). */
  rowClassName?: (row: T) => string | undefined;
  /** Satır düzeyi ipucu (`title`) — ör. "Siparişin tamamını aç": tıklamanın neyi açtığını söyler. */
  rowTitle?: (row: T) => string | undefined;
  /**
   * Etkin (yan panelde açık) satırın kimliği. Verilirse (null dahil) satırlar kayıt satırıdır: vurgulanır
   * (`aria-selected`), görünür tutulur ve tablo odaktayken ↑/↓ komşu satırı `onRowClick` ile hemen açar.
   */
  activeRowId?: string | null;
  /** Satır seçim kutusunun erişilebilir adı (ör. "Seç: <başlık>"); verilmezse "Seç". */
  selectionLabel?: (row: T) => string;
  /** false → alttaki seçim çubuğu çizilmez (sayfa seçimi kendi şeridinde gösteriyorsa). */
  showSelectionBar?: boolean;
  /** Sayfanın kendi sorgusuyla sonsuz kaydırma — altlığı sayfa çizer (`ListFooter`), tablo yalnız dibi izler. */
  loadMore?: { hasMore: boolean; isFetchingMore: boolean; onLoadMore: () => unknown };
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
  selectionBlockedReason,
  paginationActions,
  rowClassName,
  rowTitle,
  activeRowId,
  loadMore,
  renderExpanded,
  canExpand,
  expandedIds,
  onExpandedChange,
  renderSubRow,
  selectionLabel,
  showSelectionBar = true,
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
    if (!over) return;
    const next = reorderColumns(currentOrder(table), String(active.id), String(over.id));
    if (next) table.setColumnOrder(next);
  };

  const expandable = Boolean(renderExpanded);
  const { expanded, toggle: toggleExpanded } = useRowExpansion(expandedIds, onExpandedChange);
  const colCount = table.getVisibleLeafColumns().length + (selectable ? 1 : 0) + (expandable ? 1 : 0);

  // DataTableRow memo geçersizleştirme sinyalleri — bunlar OLMADAN memo satır
  // gövdesini fazla iyi tutar: sütun görünürlük/sıra veya sütun TANIMI değişince
  // (row referansı table-core'da yalnız [data]'ya bağlı olduğundan) satır
  // yeniden render OLMAZ → başlık güncellenir ama gövde bayat kalır (hizasızlık /
  // gizlenen sütun gövdede kalır / CrudPage aksiyon hücresi bayat). visibleColumnIds
  // görünürlük+sırayı, columnDefs ise hücre-closure (ör. restoreMutation.isPending)
  // değişimini yakalar. İkisi de satır SEÇİMİ toggle'ında sabit → memo hâlâ tutar.
  const visibleColumnIds = table.getVisibleLeafColumns().map((c) => c.id).join(",");
  // Genişlik değişkenleri <table>'da; satırlar yalnız değişkeni okur → genişlik değişimi satır çizdirmez.
  const widthVars = tableWidthVars(table);
  const columnDefs = table.options.columns;

  // Sonsuz kaydırma: liste dibine gelince pagination.loadMore otomatik tetiklenir
  // ("Daha Fazla Yükle" butonu kaldırıldı). rootRef = kaydırma kapsayıcısı,
  // sentinelRef = tablonun sonundaki görünmez eleman.
  const more = pagination
    ? { hasMore: pagination.hasMore, isFetchingMore: pagination.isFetchingMore, onLoadMore: pagination.loadMore }
    : loadMore;
  const { rootRef, sentinelRef } = useInfiniteScroll({
    hasMore: more?.hasMore ?? false,
    isLoading: more?.isFetchingMore ?? false,
    onLoadMore: more?.onLoadMore ?? (() => {}),
    enabled: Boolean(more),
  });
  const scrollEl = useRef<HTMLDivElement | null>(null);
  const setScrollEl = useCallback(
    (node: HTMLDivElement | null) => {
      scrollEl.current = node;
      rootRef(node);
    },
    [rootRef],
  );
  const recordRows = activeRowId !== undefined;
  // Etkin satır (↑/↓ ya da panelin önceki/sonraki düğmesi) görünür kalsın.
  useEffect(() => {
    if (!activeRowId) return;
    scrollEl.current?.querySelector(`[data-row-key="${activeRowId.replace(/"/g, '\\"')}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [activeRowId]);
  const onNavKey = recordRows && onRowClick ? (e: KeyboardEvent) => {
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (rows.length === 0) return;
    const at = rows.findIndex((r) => r.id === activeRowId);
    const next = at < 0 ? 0 : at + (e.key === "ArrowDown" ? 1 : -1);
    const target = rows[next];
    // Kenarda da tuşu yut: belgeye kabarıp yan panelin kendi ↑/↓'ını ikinci kez tetiklemesin.
    e.preventDefault();
    if (target && next !== at) onRowClick(target.original);
  } : undefined;

  return (
    <div data-list-surface="table" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={setScrollEl}
        className="flex-1 overflow-auto focus-visible:outline-none"
        onMouseOver={handleClipHover}
        tabIndex={onNavKey ? -1 : undefined}
        onKeyDown={onNavKey}
      >
        <DndContext sensors={sensors} collisionDetection={columnCollision} onDragEnd={handleDragEnd}>
          {/* containerClassName="overflow-visible": Table'ın kendi overflow-auto
              sarmalayıcısı sticky başlığı yutuyordu (thead dış scroll kabına değil
              iç sarmalayıcıya yapışıp dikeyde kayıyordu). overflow-visible ile
              tek scroll kabı = rootRef → başlık gerçekten sabit kalır. */}
          <Table containerClassName="overflow-visible" className="data-grid" style={widthVars}>
            {/* İnce ayraç çizgisi (hedef görsel): <tr> border-b'si `border-collapse: collapse`'te
                sticky başlıkla YAPIŞMAZ (çökmüş kenarlık gövdeyle boyanıp kayar).
                Çözüm: çizgiyi th hücrelerinin ARKA PLANINA linear-gradient olarak
                koy (alt 1px kenar rengi, üstü şeffaf) — arka plan çökmüş hücrelerde daima
                render olur ve th sticky başlıkla birlikte kaydıkça sabit kalır. */}
            <TableHeader className="sticky top-0 z-10 bg-card [&_th]:bg-[linear-gradient(to_top,hsl(var(--border))_1px,transparent_1px)]">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {expandable && <ExpandHeadCell />}
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
                      <SortableHead key={h.id} header={h} table={table} />
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
                  <TableCell colSpan={colCount} className="bg-warning-soft py-2 text-xs text-warning-soft-foreground">
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
                      {expandable && <TableCell className="w-8" />}
                      {selectable && (
                        <TableCell className="w-9">
                          <Skeleton className="h-4 w-4" />
                        </TableCell>
                      )}
                      {table.getVisibleLeafColumns().map((c) => (
                        <TableCell key={c.id}>
                          <Skeleton className="h-4 w-16" />
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
                        isActive={recordRows ? row.id === activeRowId : undefined}
                        selectable={selectable}
                        onRowClick={onRowClick}
                        rowContextMenu={rowContextMenu}
                        selectionBlockedReason={selectionBlockedReason}
                        rowClassName={rowClassName}
                        rowTitle={rowTitle}
                        openTimer={openTimer}
                        selRef={selRef}
                        visibleColumnIds={visibleColumnIds}
                        columnDefs={columnDefs}
                        colCount={colCount}
                        isExpanded={expandable && expanded.has(row.id)}
                        onToggleExpand={toggleExpanded}
                        renderExpanded={renderExpanded}
                        canExpand={canExpand}
                        renderSubRow={renderSubRow}
                        selectionLabel={selectionLabel}
                      />
                    ))}
            </TableBody>
          </Table>
        </DndContext>
        {/* Sonsuz kaydırma sentinel'i — görünür olunca sonraki sayfa otomatik yüklenir. */}
        {more ? <div ref={sentinelRef} aria-hidden className="h-px w-full shrink-0" /> : null}
      </div>

      {selectable && showSelectionBar && (rows.length > 0 || selected.length > 0) && (
        <SelectionBar table={table} selected={selected.map((r) => r.original)} bulkActions={bulkActions} selectionHint={selectionHint} exportName={exportName} selectedExportHint={selectedExportHint} />
      )}

      {pagination ? <DataTablePagination pagination={pagination} actions={paginationActions} /> : null}
    </div>
  );
}

interface DataTableRowProps<T> {
  row: Row<T>;
  index: number;
  isSelected: boolean;
  /** undefined → kayıt satırı değil; true/false → etkin satır vurgusu (`activeRowId`). */
  isActive?: boolean;
  selectable: boolean;
  onRowClick?: (row: T, click?: RowClick) => void;
  rowContextMenu?: (row: T) => ReactNode;
  selectionBlockedReason?: (row: T) => string | null;
  rowClassName?: (row: T) => string | undefined;
  rowTitle?: (row: T) => string | undefined;
  openTimer: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  selRef: MutableRefObject<string>;
  // Memo geçersizleştirme sinyalleri — gövdede doğrudan kullanılmaz, React.memo
  // shallow karşılaştırması görür. Sütun görünürlük/sıra (visibleColumnIds) veya
  // sütun tanımı (columnDefs) değişince satır yeniden render olur; salt seçim
  // toggle'ında ikisi de sabit → memo tutar. (Bkz. DataTable gövdesindeki not.)
  visibleColumnIds: string;
  columnDefs: ColumnDef<T>[];
  colCount: number;
  isExpanded: boolean;
  onToggleExpand: (id: string, open?: boolean) => void;
  renderExpanded?: (row: T) => ReactNode;
  canExpand?: (row: T) => boolean;
  renderSubRow?: (row: T) => ReactNode;
  selectionLabel?: (row: T) => string;
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
  isActive,
  selectable,
  onRowClick,
  rowContextMenu,
  selectionBlockedReason,
  rowClassName,
  rowTitle,
  openTimer,
  selRef,
  colCount,
  isExpanded,
  onToggleExpand,
  renderExpanded,
  canExpand,
  renderSubRow,
  selectionLabel,
}: DataTableRowProps<T>) {
  const blocked = selectable && !row.getCanSelect() ? (selectionBlockedReason?.(row.original) ?? null) : null;
  const expandable = Boolean(renderExpanded);
  const can = expandable && (canExpand?.(row.original) ?? true);
  const subRow = renderSubRow?.(row.original);
  // Satır açılışı yoksa tık/Enter ayrıntıyı açıp kapar (genişleyen satırın tek eylemi odur).
  const activate = onRowClick ?? (can ? () => onToggleExpand(row.id) : undefined);
  const detailId = `row-detail-${row.id}`;
  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (!activate) return;
    // Bekleyen açılışı HER tıkta iptal et — çift-tıkın 2. tıkı (aşağıdaki guard'lardan erken çıksa bile) 1. tıkın
    // zamanlayıcısını öldürsün.
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (fromInteractive(e)) return;
    // Sürükleyerek/çift-tıkla metin seçildiyse satırı açma.
    if (window.getSelection()?.toString()) return;
    // 2./3. tık (çift-tık) → boş hücrede bile açma.
    if (e.detail > 1) return;
    const data = row.original;
    // Olay zamanlayıcıdan önce okunur: değiştiriciler (Ctrl/⌘ → yeni sekme) açılışa taşınır.
    const click: RowClick = { button: e.button, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      activate(data, click);
    }, ROW_OPEN_DELAY_MS);
  };
  const rowEl = (
    <TableRow
      data-state={isSelected ? "selected" : undefined}
      {...(isActive === undefined ? {} : { "data-record-row": "", "data-row-key": row.id, "aria-selected": isActive })}
      className={cn(
        "row-enter",
        activate && "cursor-pointer",
        isActive && "bg-primary-soft hover:bg-primary-soft",
        (activate || can) && "focus-visible:bg-accent/60 focus-visible:outline-none",
        subRow ? "border-b-0" : undefined,
        rowClassName?.(row.original),
      )}
      style={{ animationDelay: `${Math.min(index, 10) * 25}ms` }}
      title={rowTitle?.(row.original)}
      // Klavye erişimi: tıklanabilir satır Tab ile odaklanır, Enter/Space açar (hücre içi düğmeler hariç); →/← ayrıntı.
      tabIndex={activate || can ? 0 : undefined}
      onKeyDown={activate || can ? (e) => {
        if (e.target !== e.currentTarget) return;
        if (expandKey(e.key, can, isExpanded, (open) => onToggleExpand(row.id, open))) {
          e.preventDefault();
          return;
        }
        if (!activate || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        activate(row.original, { button: 0, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
      } : undefined}
      onClick={handleClick}
    >
      {expandable && <ExpandToggleCell can={can} open={isExpanded} onToggle={() => onToggleExpand(row.id)} controls={detailId} />}
      {selectable && (
        <TableCell className="w-9" onClick={(e) => e.stopPropagation()}>
          {/* Seçilemez satırlarda (enableRowSelection predicate false —
              ör. sevkteki çuval) checkbox gizlenir; boş hücre hizayı korur. */}
          {row.getCanSelect() ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              aria-label={selectionLabel?.(row.original) ?? "Seç"}
            />
          ) : blocked ? (
            <span title={blocked} className="inline-flex">
              <Checkbox checked={false} disabled aria-label={`Seçilemez: ${blocked}`} />
            </span>
          ) : null}
        </TableCell>
      )}
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id} className={alignClass(cell.column.columnDef.meta)}>
          <div data-cell-clip={cell.column.id} className={cell.column.columnDef.meta?.wrap ? "whitespace-normal break-words" : "truncate"} style={clipStyle(cell.column.id, true)}>
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </div>
        </TableCell>
      ))}
    </TableRow>
  );

  const menu = rowContextMenu?.(row.original);
  const extra = (
    <>
      {subRow ? (
        <ExpandedRow colSpan={colCount} className={rowClassName?.(row.original)} onClick={onRowClick ? () => onRowClick(row.original) : undefined}>
          {subRow}
        </ExpandedRow>
      ) : null}
      {isExpanded && can ? <ExpandedRow id={detailId} colSpan={colCount} className="bg-muted/20">{renderExpanded?.(row.original)}</ExpandedRow> : null}
    </>
  );
  if (!menu) return <>{rowEl}{extra}</>;
  return (
    <>
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
    {extra}
    </>
  );
}

// memo + generic korunumu: memo default shallow karşılaştırması props için yeterli
// (row/refs kararlı, isSelected/index/selectable primitive).
const DataTableRow = memo(DataTableRowInner) as typeof DataTableRowInner;

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
