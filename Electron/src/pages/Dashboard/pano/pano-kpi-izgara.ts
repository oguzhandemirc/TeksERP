import { useLayoutEffect, useState, type CSSProperties } from "react";

/** KPI kartının en dar genişliği (px) — para değeri bu genişlikte birimi alt satıra indirerek sığar. */
export const KPI_MIN_PX = 170;

/**
 * Şeritte sütun sayısı: kartlar tek satıra sığıyorsa satırı eşit paylaşır; sarıyorsa satırlar dengelenir
 * (7 kart / 6 sığar → 4 + 3; tek yetim kart kalmaz). Son satır önceki satırla aynı genişlikte, sola dayalı.
 */
export function kpiColumns(count: number, width: number, gap: number, min = KPI_MIN_PX): number {
  if (count <= 0) return 1;
  const fit = Math.max(1, Math.floor((width + gap) / (min + gap)));
  if (count <= fit) return count;
  return Math.ceil(count / Math.ceil(count / fit));
}

/** Şeridin genişliğini izler; ölçülene dek `auto-fit` sınıfı (ilk boyamada) iş görür. */
export function useKpiGrid(count: number): { ref: (el: HTMLDivElement | null) => void; style: CSSProperties | undefined } {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.clientWidth;
      if (w <= 0) return;
      const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0;
      setCols(kpiColumns(count, w, gap));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, count]);
  return { ref: setEl, style: cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined };
}
