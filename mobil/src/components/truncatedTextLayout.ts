// =============================================================================
// TruncatedText — tam ad balonunun konumu (SAF katman, birim testli)
// =============================================================================
// Balon tetik ölçülmeden, DOKUNMA NOKTASINDAN konumlanır: `measureInWindow`
// turu yok (AppMenu'deki ölç→state→layout döngüsü riski burada hiç doğmaz).
// Tercih parmağın ÜSTÜ (el aşağıdan gelir, alt tarafı örter); yer yoksa altı.
// Kutu yatayda noktaya ortalanır ve ekran kenarına kırpılır.
// =============================================================================

export interface BalloonPoint {
  x: number;
  y: number;
}

export interface BalloonViewport {
  width: number;
  height: number;
}

export interface BalloonLayout {
  left: number;
  width: number;
  /** `top` VEYA `bottom` dolu olur — ikisi birden asla. */
  top?: number;
  bottom?: number;
  maxHeight: number;
  above: boolean;
}

export const BALLOON_DEFAULTS = {
  margin: 8,
  /** Dokunma noktası ile balon arasındaki pay (parmak ucu örtmesin). */
  finger: 36,
  /** Üstte bu kadar yer yoksa balon alta açılır. */
  minAbove: 96,
  maxWidth: 560,
} as const;

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(n, lo), hi);
}

export function computeBalloonLayout(point: BalloonPoint, viewport: BalloonViewport): BalloonLayout {
  const { margin, finger, minAbove, maxWidth } = BALLOON_DEFAULTS;
  const vw = Math.max(0, finite(viewport.width));
  const vh = Math.max(0, finite(viewport.height));
  const px = clamp(finite(point.x), 0, vw);
  const py = clamp(finite(point.y), 0, vh);

  const width = Math.max(0, Math.min(maxWidth, vw - 2 * margin));
  const left = clamp(px - width / 2, margin, vw - margin - width);

  const spaceAbove = py - finger - margin;
  if (spaceAbove >= minAbove) {
    return { left, width, bottom: vh - (py - finger), maxHeight: spaceAbove, above: true };
  }
  const top = Math.min(py + finger, Math.max(margin, vh - margin));
  return { left, width, top, maxHeight: Math.max(0, vh - margin - top), above: false };
}
