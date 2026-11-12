import { useCallback, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Column, Table as TanstackTable } from "@tanstack/react-table";

// =============================================================================
// SÜTUN DÜZENİ — tek satır hücre, elle genişlik, taşan metne ipucu (kullanıcı 2026-11-12)
// =============================================================================
// Genişlik `<table>` üzerindeki CSS değişkeninden okunur (`--cw-<id>`): sürüklerken yalnız değişken
// yazılır (satırlar yeniden çizilmez), bırakınca TanStack `columnSizing`e (→ kullanıcı tercihi) işlenir.
// Değişken yoksa sütun doğal genişliğinde kalır ama `DEFAULT_COL_CAP` ile sınırlanır; taşan "…" olur.
// =============================================================================

export const MIN_COL_WIDTH = 48;
/** Genişliği verilmemiş sütunun doğal tavanı (px) — uzun cari/kumaş adı tabloyu yaymasın. */
export const DEFAULT_COL_CAP = 280;
/** Hücre yatay dolgusu (px-3 × 2) — değişken DIŞ genişliği taşır, kutu içi = dış − dolgu. */
const CELL_PAD = "1.5rem";
const TANSTACK_DEFAULT_SIZE = 150;

/** Sütun kimliği → CSS değişken adı (nokta/boşluk gibi karakterler değişkende geçersiz). */
export function widthVar(columnId: string): string {
  return `--cw-${columnId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function widthValue(px: number): string {
  return `calc(${Math.round(px)}px - ${CELL_PAD})`;
}

/** Sütunun sabit genişliği: kullanıcının sürüklediği > sütun tanımındaki `size` > yok (doğal). */
export function fixedWidth<T>(column: Column<T, unknown>, sizing: Record<string, number>): number | undefined {
  const user = sizing[column.id];
  if (typeof user === "number" && user > 0) return Math.max(MIN_COL_WIDTH, user);
  // TanStack varsayılanı (150) her tanıma karışır → 150 "verilmemiş" sayılır (eski th kuralıyla aynı).
  const size = column.columnDef.size;
  return size && size !== TANSTACK_DEFAULT_SIZE ? size : undefined;
}

/** `<table style>` — sabit genişlikli her sütunun değişkeni. */
export function tableWidthVars<T>(table: TanstackTable<T>): CSSProperties {
  const sizing = table.getState().columnSizing ?? {};
  const vars: Record<string, string> = {};
  for (const col of table.getVisibleLeafColumns()) {
    const w = fixedWidth(col, sizing);
    if (w) vars[widthVar(col.id)] = widthValue(w);
  }
  return vars as CSSProperties;
}

/** Hücre kutusu: değişken varsa tam o genişlik, yoksa doğal (gövdede tavanlı). */
export function clipStyle(columnId: string, capped: boolean): CSSProperties {
  const v = widthVar(columnId);
  return {
    width: `var(${v}, auto)`,
    maxWidth: capped ? `var(${v}, ${DEFAULT_COL_CAP}px)` : `var(${v}, none)`,
  };
}

/** Sütundaki içeriğin taşmasız genişliği (px, dolgu dahil) — çift tıkla "sığdır". */
export function measureContentWidth(tableEl: HTMLTableElement, columnId: string): number {
  let max = 0;
  for (const el of tableEl.querySelectorAll<HTMLElement>(`[data-cell-clip="${CSS.escape(columnId)}"]`)) {
    max = Math.max(max, el.scrollWidth);
  }
  const pad = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 1.5;
  return Math.max(MIN_COL_WIDTH, Math.ceil(max + pad + 2));
}

function commitWidth<T>(table: TanstackTable<T>, columnId: string, px: number): void {
  table.setColumnSizing((prev) => ({ ...prev, [columnId]: Math.max(MIN_COL_WIDTH, Math.round(px)) }));
}

/** Başlığın sağ kenarındaki tutamaç: sürükle → genişlik, çift tık → içeriğe sığdır. */
export function ColumnResizeHandle<T>({ table, columnId, label }: { table: TanstackTable<T>; columnId: string; label: string }) {
  const drag = useRef<{ startX: number; startW: number; tableEl: HTMLTableElement; w: number } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Sürükle-bırak sıralaması başlıkta dinler; tutamaç kendi işini yapar.
    e.stopPropagation();
    e.preventDefault();
    const th = e.currentTarget.closest("th");
    const tableEl = e.currentTarget.closest("table");
    if (!th || !tableEl) return;
    const startW = th.getBoundingClientRect().width;
    drag.current = { startX: e.clientX, startW, tableEl, w: startW };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    tableEl.dataset.resizing = "true";
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.w = Math.max(MIN_COL_WIDTH, d.startW + e.clientX - d.startX);
    d.tableEl.style.setProperty(widthVar(columnId), widthValue(d.w));
  }, [columnId]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    delete d.tableEl.dataset.resizing;
    if (Math.abs(d.w - d.startW) >= 1) commitWidth(table, columnId, d.w);
  }, [table, columnId]);

  const onDoubleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const tableEl = e.currentTarget.closest("table");
    if (!tableEl) return;
    // Önce değişkeni kaldır: ölçüm sabit genişliğe değil içeriğe baksın.
    tableEl.style.removeProperty(widthVar(columnId));
    commitWidth(table, columnId, measureContentWidth(tableEl, columnId));
  }, [table, columnId]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} sütun genişliği`}
      title="Genişlik: sürükleyin · çift tık: içeriğe sığdır"
      data-col-resizer=""
      className="absolute inset-y-0 -right-1 z-[1] w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-primary after:opacity-0 after:transition-opacity hover:after:opacity-60"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/**
 * Taşan hücreye tam metin ipucu — satır başına dinleyici yerine kapsayıcıda TEK delege dinleyici.
 * `title` yalnız gerçekten kesilmiş kutuya konur; kendi koyduğumuz ipucu taşma bitince kalkar.
 */
export function handleClipHover(e: ReactMouseEvent<HTMLElement>): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-cell-clip]");
  if (!el) return;
  const overflowing = el.scrollWidth > el.clientWidth + 1;
  if (overflowing && !el.title) {
    el.title = el.innerText.trim();
    el.dataset.autoTitle = "";
  } else if (!overflowing && el.dataset.autoTitle !== undefined) {
    el.removeAttribute("title");
    delete el.dataset.autoTitle;
  }
}
