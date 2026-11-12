import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";

/** Izgara satır birimi (px) — `auto-rows-[4px]` ile aynı; kutu boyu bu birimin katına yuvarlanır. */
export const ROW_UNIT = 4;

/** İçerik yüksekliği → kaç satır birimi (satır aralığı 0; kutular arası boşluk hücrenin alt dolgusunda). */
export function rowSpanFor(height: number): number {
  return Math.max(1, Math.ceil(height / ROW_UNIT));
}

export interface MasonryItem { key: string; span: number; rows: number }
export interface MasonryPlace { col: number; row: number; span: number }

/**
 * Sütun akışı: kutular SIRAYLA yerleşir; her kutu, kapladığı sütunların en alçak hizasına (eşitlikte en sol)
 * oturur → kısa kutunun altına sonraki kutu girer. Genişlik ±1 sütun esner (12'lik ızgarada, en az 3): 3/4/8
 * karışımında açılan dar boşluk bir sonraki kutuyla dolar. Değerler 1 tabanlı ızgara çizgisi.
 */
export function placeMasonry(items: readonly MasonryItem[], cols: number): Record<string, MasonryPlace> {
  const heights = Array.from({ length: cols }, () => 0);
  const out: Record<string, MasonryPlace> = {};
  for (const it of items) {
    const want = Math.min(Math.max(1, it.span), cols);
    const spans = cols >= 12 ? [want, want - 1, want + 1].filter((s) => s >= 3 && s <= cols) : [want];
    let best = { col: 0, top: Infinity, span: want };
    for (const span of spans) {
      for (let c = 0; c + span <= cols; c++) {
        const top = Math.max(...heights.slice(c, c + span));
        if (top < best.top) best = { col: c, top, span };
      }
    }
    if (cols >= 12) best = absorbSlivers(heights, best);
    out[it.key] = { col: best.col + 1, row: best.top + 1, span: best.span };
    for (let c = best.col; c < best.col + best.span; c++) heights[c] = best.top + it.rows;
  }
  return out;
}

/** Kutunun yanında kalan 1–2 sütunluk (hiçbir kutunun giremeyeceği) şeridi kutuya katar. */
function absorbSlivers(heights: number[], b: { col: number; top: number; span: number }) {
  let { col, span } = b;
  let w = 0;
  while (col - w - 1 >= 0 && heights[col - w - 1]! <= b.top) w++;
  if (w > 0 && w < 3) { col -= w; span += w; }
  w = 0;
  while (col + span + w < heights.length && heights[col + span + w]! <= b.top) w++;
  if (w > 0 && w < 3) span += w;
  return { col, top: b.top, span };
}

/** Izgaranın o anki sütun sayısı (kırılım noktasına göre 1 / 2 / 12); ızgara sonradan doğabilir → ref geri çağrısı. */
function useGridColumns(): [number, (el: HTMLDivElement | null) => void] {
  const [cols, setCols] = useState(0);
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const read = () => setCols(getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  return [cols, gridRef];
}

/**
 * Hücre içeriklerini ölçer ve açık konum (`grid-column` / `grid-row`) verir. Ölçüm yoksa (test ortamı)
 * stil verilmez → olağan ızgara akışı.
 */
export function useMasonry(items: ReadonlyArray<{ key: string; span: (cols: number) => number }>) {
  const [cols, gridRef] = useGridColumns();
  const [rows, setRows] = useState<Record<string, number>>({});
  const observers = useRef(new Map<string, ResizeObserver>());
  const refs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());

  // Anahtar başına KALICI ref geri çağrısı: her çizimde gözlemci yeniden kurulmasın.
  const measure = useCallback((key: string) => {
    const known = refs.current.get(key);
    if (known) return known;
    const fn = (el: HTMLDivElement | null) => attach(key, el);
    refs.current.set(key, fn);
    return fn;
  }, []);

  function attach(key: string, el: HTMLDivElement | null) {
    observers.current.get(key)?.disconnect();
    observers.current.delete(key);
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const n = rowSpanFor(el.getBoundingClientRect().height);
      setRows((cur) => (cur[key] === n ? cur : { ...cur, [key]: n }));
    });
    ro.observe(el);
    observers.current.set(key, ro);
  }

  const places = useMemo(() => {
    if (cols === 0 || items.some((i) => rows[i.key] === undefined)) return null;
    return placeMasonry(items.map((i) => ({ key: i.key, span: i.span(cols), rows: rows[i.key]! })), cols);
  }, [cols, items, rows]);

  const styleOf = useCallback((key: string): CSSProperties => {
    const p = places?.[key];
    if (!p) return {};
    return { gridColumn: `${p.col} / span ${p.span}`, gridRow: `${p.row} / span ${rows[key]}` };
  }, [places, rows]);

  return { gridRef, measure, styleOf };
}
