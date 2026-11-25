// =============================================================================
// KARE IZGARA (armür + atkı seçici) — saf yerleşim hesabı; çizim `WeaveGrid.tsx`te
// =============================================================================
// Satır = atkı, sütun = çerçeve, hücre 0/1 (sunucu `liftPlan`; ≤32 × 512). Sağda atkı seçici bloğu:
// atkı j'de `pickSequence[j]` (1-tabanlı iplik no) sütunu dolu. İstemci sırayı HESAPLAMAZ — sunucunun
// açtığı diziyi çizer. Satır sayısı ikisinin büyüğü (panel `LiftPlanTab` ile aynı). Yön yalnız görünüm:
// 'bottom-up' = tezgâh ekranı gibi 1. atkı EN ALTTA; veri satır sırası değişmez.
// Bütün dolu hücreler renk başına TEK path (512 satırda bile tek düğüm).
// =============================================================================

export type GridDirection = 'bottom-up' | 'top-down';

export interface WeaveGridInput {
  liftPlan: number[][] | null | undefined;
  lenoFrames?: readonly number[] | null;
  /** Kenar çerçeveleri (1-tabanlı) — yalnız zemin tonu (yeşil); döner çerçeveyle çakışan atlanır. */
  selvedgeFrames?: readonly number[] | null;
  pickSequence?: readonly number[] | null;
  /** Atkı kartındaki iplik sayısı (seçici sütunu); dizide daha büyük no varsa o kadar sütun açılır. */
  yarnCount?: number;
}

export interface WeaveGridShape {
  rows: number;
  frames: number;
  selCount: number;
}

export const SELECTOR_GAP_CELLS = 1;

/** Görsel çizilebilir mi? Eski sunucu (alan yok) ya da boş armür → false (bugünkü metin kartı). */
export function hasLiftPlan(plan: unknown): plan is number[][] {
  return Array.isArray(plan) && plan.length > 0 && plan.some((r) => Array.isArray(r) && r.length > 0);
}

export function weaveGridShape(input: WeaveGridInput, maxRows?: number): WeaveGridShape {
  const plan = hasLiftPlan(input.liftPlan) ? input.liftPlan : [];
  const seq = Array.isArray(input.pickSequence) ? input.pickSequence : [];
  const frames = plan.reduce((m, row) => Math.max(m, Array.isArray(row) ? row.length : 0), 0);
  const seqMax = seq.reduce((m, v) => Math.max(m, Number.isInteger(v) ? v : 0), 0);
  const selCount = seq.length > 0 ? Math.max(input.yarnCount ?? 0, seqMax) : 0;
  const all = Math.max(plan.length, seq.length);
  return { rows: maxRows != null ? Math.min(all, maxRows) : all, frames, selCount };
}

export interface WeaveGridLayout extends WeaveGridShape {
  cell: number;
  width: number;
  height: number;
  /** Seçici bloğunun sol kenarı (px). */
  selectorX: number;
  /** Zemin çerçevelerinde kalkık hücreler. */
  liftPath: string;
  /** Döner çerçevelerde kalkık hücreler. */
  lenoLiftPath: string;
  /** Döner çerçeve sütunlarının zemini. */
  lenoBgPath: string;
  /** Kenar çerçevesi sütunlarının zemini. */
  selvedgeBgPath: string;
  /** Seçici: iplik no (1-tabanlı) → dolu hücre path'i. */
  selectorPaths: { yarn: number; d: string }[];
  /** Izgara çizgileri (iki blok). */
  linesPath: string;
}

const rect = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;

/** Atkı (0-tabanlı) → satırın üst kenarı (px). */
export function rowTop(pick: number, rows: number, cell: number, direction: GridDirection): number {
  return (direction === 'bottom-up' ? rows - 1 - pick : pick) * cell;
}

export function weaveGridLayout(input: WeaveGridInput, cell: number, direction: GridDirection, maxRows?: number): WeaveGridLayout {
  const shape = weaveGridShape(input, maxRows);
  const { rows, frames, selCount } = shape;
  const plan = hasLiftPlan(input.liftPlan) ? input.liftPlan : [];
  const leno = new Set((input.lenoFrames ?? []).filter((f) => f >= 1 && f <= frames));
  const seq = Array.isArray(input.pickSequence) ? input.pickSequence : [];
  const selectorX = (frames + (selCount > 0 ? SELECTOR_GAP_CELLS : 0)) * cell;
  const width = selectorX + selCount * cell;
  const height = rows * cell;

  let liftPath = '';
  let lenoLiftPath = '';
  const sel = new Map<number, string>();
  for (let r = 0; r < rows; r++) {
    const y = rowTop(r, rows, cell, direction);
    const row = plan[r];
    if (Array.isArray(row)) {
      for (let c = 0; c < frames; c++) {
        if (row[c] !== 1) continue;
        if (leno.has(c + 1)) lenoLiftPath += rect(c * cell, y, cell, cell);
        else liftPath += rect(c * cell, y, cell, cell);
      }
    }
    const yarn = seq[r];
    if (selCount > 0 && Number.isInteger(yarn) && yarn! >= 1 && yarn! <= selCount) {
      sel.set(yarn!, (sel.get(yarn!) ?? '') + rect(selectorX + (yarn! - 1) * cell, y, cell, cell));
    }
  }
  let lenoBgPath = '';
  for (const f of leno) lenoBgPath += rect((f - 1) * cell, 0, cell, height);
  let selvedgeBgPath = '';
  for (const f of new Set(input.selvedgeFrames ?? [])) {
    if (f >= 1 && f <= frames && !leno.has(f)) selvedgeBgPath += rect((f - 1) * cell, 0, cell, height);
  }

  let linesPath = '';
  const block = (x0: number, cols: number) => {
    if (cols === 0 || rows === 0) return;
    for (let c = 0; c <= cols; c++) linesPath += `M${x0 + c * cell} 0v${height}`;
    for (let r = 0; r <= rows; r++) linesPath += `M${x0} ${r * cell}h${cols * cell}`;
  };
  block(0, frames);
  block(selectorX, selCount);

  const selectorPaths = [...sel.entries()].sort((a, b) => a[0] - b[0]).map(([yarn, d]) => ({ yarn, d }));
  return { ...shape, cell, width, height, selectorX, liftPath, lenoLiftPath, lenoBgPath, selvedgeBgPath, selectorPaths, linesPath };
}

/** Tam ekran hücre boyu: satırlar yüksekliğe, sütunlar genişliğe sığsın; [min, max] arasında (sığmazsa kaydırma). */
export function fitCell(shape: WeaveGridShape, avail: { width: number; height: number }, min = 10, max = 28): number {
  const { width: availWidth, height: availHeight } = avail;
  const cols = shape.frames + shape.selCount + (shape.selCount > 0 ? SELECTOR_GAP_CELLS : 0);
  const byW = cols > 0 ? availWidth / cols : max;
  const byH = shape.rows > 0 ? availHeight / shape.rows : max;
  return Math.max(min, Math.min(max, Math.floor(Math.min(byW, byH))));
}
