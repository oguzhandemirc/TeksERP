// Etiket kâğıdının ölçülen alana sığma ölçeği (px/mm): hem genişliğe hem yüksekliğe sığar, oran korunur.
// Geniş kesim sol sütunu kaydırmasızdır (2026-11-11) — kâğıt alanı taşmamalı, ölçek bu yüzden iki sınırın küçüğü.
export function fitPaperScale(availW: number, availH: number, paperWmm: number, paperHmm: number): number {
  if (!(availW > 0) || !(availH > 0) || !(paperWmm > 0) || !(paperHmm > 0)) return 0;
  return Math.min(availW / paperWmm, availH / paperHmm);
}

// Önizleme yakınlaştırması (kullanıcı 2026-11-11): 1× = sığdırılmış kâğıt, en çok 4×. Gesture worklet'lerinden de çağrılır.
export const PAPER_ZOOM_MIN = 1;
export const PAPER_ZOOM_MAX = 4;
export const PAPER_ZOOM_DOUBLE_TAP = 2;

export function clampPaperZoom(z: number): number {
  'worklet';
  if (!Number.isFinite(z)) return PAPER_ZOOM_MIN;
  return Math.min(PAPER_ZOOM_MAX, Math.max(PAPER_ZOOM_MIN, z));
}

/**
 * Yakın kâğıdın bir eksende en çok ne kadar kayabileceği (px, ± simetrik). Kâğıt alanın ortasında, merkezden ölçeklenir;
 * kenarı alanın kenarını geçmez → büyütülmüş boy alanı aşmıyorsa 0 (1×'te kaydırma yok).
 */
export function paperPanLimit(paperPx: number, areaPx: number, zoom: number): number {
  'worklet';
  if (!(paperPx > 0) || !(areaPx > 0)) return 0;
  return Math.max(0, (paperPx * clampPaperZoom(zoom) - areaPx) / 2);
}

export function clampPaperPan(t: number, limit: number): number {
  'worklet';
  if (!Number.isFinite(t)) return 0;
  return Math.min(limit, Math.max(-limit, t));
}

/** Çift dokunuş: yakınsa 1×'e, 1×'teyse 2×'e. */
export function doubleTapZoom(z: number): number {
  'worklet';
  return z > PAPER_ZOOM_MIN + 0.01 ? PAPER_ZOOM_MIN : PAPER_ZOOM_DOUBLE_TAP;
}
