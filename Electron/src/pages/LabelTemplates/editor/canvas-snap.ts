// =============================================================================
// Etiket Stüdyosu — akıllı hizalama (snap) kılavuzları
// =============================================================================
// Sürüklenen elemanın kenar/merkezi başka elemanların veya tuval kenarı/merkezinin
// EŞİK içinde hizalanınca konumu oturtur (snap) + kılavuz çizgisi döndürür. Saf mm
// (zoom'dan bağımsız). Sınırlar estimateBounds tahminiyle.

import type { BoundsMm } from "./canvas-model";

/** Snap eşiği (mm) — bu mesafe içinde hizalanınca yakalar. */
export const SNAP_THRESHOLD_MM = 0.8;

export interface SnapResult {
  /** Ham konuma eklenecek düzeltme (mm) — hizalamaya oturtur. */
  dx: number;
  dy: number;
  /** Çizilecek dikey kılavuz X konumları (mm). */
  vGuides: number[];
  /** Çizilecek yatay kılavuz Y konumları (mm). */
  hGuides: number[];
}

/** Bir eksende en yakın hedefe snap — {delta, line} veya null (eşik dışı). */
function bestSnap(anchors: number[], targets: number[], threshold: number): { delta: number; line: number } | null {
  let best: { delta: number; line: number } | null = null;
  for (const a of anchors) {
    for (const t of targets) {
      const delta = t - a;
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, line: t };
      }
    }
  }
  return best;
}

/**
 * Sürüklenen kutuyu (ham dx/dy sonrası) diğer elemanlara + tuval kenar/merkezine
 * hizala. Hedefler: her diğer elemanın sol/orta/sağ (X) ve üst/orta/alt (Y) + tuval
 * 0/merkez/kenar. Eksene özel EN YAKIN hedef seçilir (varsa).
 */
export function computeSnap(
  box: BoundsMm,
  others: BoundsMm[],
  canvas: { widthMm: number; heightMm: number },
  threshold = SNAP_THRESHOLD_MM,
): SnapResult {
  const xTargets = [0, canvas.widthMm / 2, canvas.widthMm];
  const yTargets = [0, canvas.heightMm / 2, canvas.heightMm];
  for (const b of others) {
    xTargets.push(b.x, b.x + b.w / 2, b.x + b.w);
    yTargets.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  const xAnchors = [box.x, box.x + box.w / 2, box.x + box.w];
  const yAnchors = [box.y, box.y + box.h / 2, box.y + box.h];

  const sx = bestSnap(xAnchors, xTargets, threshold);
  const sy = bestSnap(yAnchors, yTargets, threshold);

  return {
    dx: sx?.delta ?? 0,
    dy: sy?.delta ?? 0,
    vGuides: sx ? [sx.line] : [],
    hGuides: sy ? [sy.line] : [],
  };
}
