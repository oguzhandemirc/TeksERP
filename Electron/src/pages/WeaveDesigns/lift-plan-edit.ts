// Armür editörünün SAF düzenleme işlemleri (dobby editörleri gibi: sürükle-boya, seçim, kopyala/yapıştır,
// tekrarla, ayna, kaydır, hazır örgü, satır/çerçeve ekle-sil, geri al yığını). Hepsi değişmez kopya döner;
// değişmeyen satır aynı dizi kalır (ızgara satırı yeniden çizilmez). Tavan `lift-plan.ts`; asıl kapı sunucuda.
import { LIFT_PLAN_MAX_FRAMES, LIFT_PLAN_MAX_PICKS } from "./lift-plan";
import type { LiftPlan } from "./types";

/** 0-tabanlı hücre: r = atkı (veri satırı), c = çerçeve. */
export interface Cell { r: number; c: number }
/** Kapalı aralık, normalize (r0 ≤ r1, c0 ≤ c1). */
export interface Rect { r0: number; c0: number; r1: number; c1: number }
export type Block = number[][];

export function normRect(a: Cell, b: Cell): Rect {
  return { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) };
}

export function frameCountOf(plan: LiftPlan): number {
  return plan.reduce((m, row) => Math.max(m, row.length), 0);
}

/** Bütün ızgara; boşsa null. */
export function fullRect(plan: LiftPlan): Rect | null {
  const f = frameCountOf(plan);
  return plan.length === 0 || f === 0 ? null : { r0: 0, c0: 0, r1: plan.length - 1, c1: f - 1 };
}

/** Aralığı ızgaraya kırpar; tamamen dışarıdaysa null. */
export function clampRect(plan: LiftPlan, rect: Rect): Rect | null {
  const full = fullRect(plan);
  if (!full) return null;
  const r = { r0: Math.max(0, rect.r0), c0: Math.max(0, rect.c0), r1: Math.min(full.r1, rect.r1), c1: Math.min(full.c1, rect.c1) };
  return r.r0 > r.r1 || r.c0 > r.c1 ? null : r;
}

export const inRect = (rect: Rect | null, r: number, c: number): boolean =>
  !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1;

/** Sürüklemede iki hücre arası (hızlı fare hücre atlamasın): Bresenham doğrusu, uçlar dahil. */
export function cellsOnLine(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  let { r, c } = a;
  const dr = Math.abs(b.r - a.r);
  const dc = Math.abs(b.c - a.c);
  const sr = a.r < b.r ? 1 : -1;
  const sc = a.c < b.c ? 1 : -1;
  let err = dc - dr;
  for (;;) {
    out.push({ r, c });
    if (r === b.r && c === b.c) return out;
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 < dc) { err += dc; r += sr; }
  }
}

/** Hücreleri tek değere boyar (sürükle-boya / sil). Izgara dışı ve değişmeyen hücre yok sayılır. */
export function setCells(plan: LiftPlan, cells: readonly Cell[], value: 0 | 1): LiftPlan {
  let out: LiftPlan | null = null;
  for (const { r, c } of cells) {
    const row = (out ?? plan)[r];
    if (!row || c < 0 || c >= row.length || row[c] === value) continue;
    out ??= plan.slice();
    const next = row.slice();
    next[c] = value;
    out[r] = next;
  }
  return out ?? plan;
}

export function copyRect(plan: LiftPlan, rect: Rect): Block {
  const out: Block = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const row: number[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) row.push(plan[r]?.[c] === 1 ? 1 : 0);
    out.push(row);
  }
  return out;
}

/** Bloğu sol-alt köşesi `at` olacak biçimde yazar (ızgarayı büyütmez, taşan kısım kırpılır). */
export function pasteAt(plan: LiftPlan, block: Block, at: Cell): LiftPlan {
  const f = frameCountOf(plan);
  let changed = false;
  const out = plan.map((row, r) => {
    const src = block[r - at.r];
    if (!src) return row;
    let next: number[] | null = null;
    for (let k = 0; k < src.length; k++) {
      const c = at.c + k;
      if (c < 0 || c >= f) continue;
      const v = src[k] === 1 ? 1 : 0;
      if ((row[c] ?? 0) !== v) {
        next ??= row.slice();
        next[c] = v;
      }
    }
    if (next) changed = true;
    return next ?? row;
  });
  return changed ? out : plan;
}

/** Aralıktaki bloğu bir dönüşümle değiştirir (dönüşüm aynı boyda blok döndürür). */
export function mapRect(plan: LiftPlan, rect: Rect, fn: (b: Block) => Block): LiftPlan {
  return pasteAt(plan, fn(copyRect(plan, rect)), { r: rect.r0, c: rect.c0 });
}

/** Atkı sırasını ters çevirir (dikey ayna). */
export const flipPicks = (b: Block): Block => b.slice().reverse();
/** Çerçeve sırasını ters çevirir (yatay ayna). */
export const flipFrames = (b: Block): Block => b.map((row) => row.slice().reverse());
/** Dolu ↔ boş (çözgü yüzlü ↔ atkı yüzlü). */
export const invertBlock = (b: Block): Block => b.map((row) => row.map((v) => (v === 1 ? 0 : 1)));
export const clearBlock = (b: Block): Block => b.map((row) => row.map(() => 0));

/** Döngüsel kaydırma: dr > 0 bloğu sonraki atkılara, dc > 0 sonraki çerçevelere iter (taşan baştan girer). */
export function shiftBlock(b: Block, dr: number, dc: number): Block {
  const h = b.length;
  const w = b[0]?.length ?? 0;
  if (h === 0 || w === 0) return b;
  const mod = (n: number, m: number) => ((n % m) + m) % m;
  return b.map((_, r) => b[mod(r - dr, h)]!.map((_, c) => b[mod(r - dr, h)]![mod(c - dc, w)]!));
}

/**
 * Seçili bloğu ızgaranın sonuna dek tekrarlar: "picks" → aynı çerçevelerde sonraki atkılara,
 * "frames" → aynı atkılarda sonraki çerçevelere. Ilk blok değişmez.
 */
export function repeatRect(plan: LiftPlan, rect: Rect, axis: "picks" | "frames"): LiftPlan {
  const block = copyRect(plan, rect);
  const h = block.length;
  const w = block[0]?.length ?? 0;
  if (h === 0 || w === 0) return plan;
  const f = frameCountOf(plan);
  return plan.map((row, r) => {
    if (axis === "picks" && r < rect.r0) return row;
    if (axis === "frames" && (r < rect.r0 || r > rect.r1)) return row;
    let next: number[] | null = null;
    const c0 = axis === "frames" ? rect.c0 : rect.c0;
    const c1 = axis === "frames" ? f - 1 : rect.c1;
    for (let c = c0; c <= c1; c++) {
      const v = block[(r - rect.r0) % h]![(c - rect.c0) % w]!;
      if ((row[c] ?? 0) !== v) {
        next ??= row.slice();
        next[c] = v;
      }
    }
    return next ?? row;
  });
}

// ---------------------------------------------------------------------------
// Hazır örgüler — birim rapor: satır = atkı, sütun = çerçeve (zemin çerçeveleri sırayla), 1 = kalkık.
// ---------------------------------------------------------------------------

export type WeaveTemplateId = "plain" | "twill21" | "twill22" | "twill13" | "satin4" | "satin5" | "basket22";

export interface WeaveTemplate { id: WeaveTemplateId; label: string; unit: Block }

/** Saten: her atkıda tek çerçeve kalkar; `order` atkı başına kalkan çerçeve (0-tabanlı). */
const satin = (order: readonly number[]): Block => order.map((k) => order.map((_, c) => (c === k ? 1 : 0)));

export const WEAVE_TEMPLATES: readonly WeaveTemplate[] = [
  { id: "plain", label: "Bez ayağı (1/1)", unit: [[1, 0], [0, 1]] },
  { id: "twill21", label: "Dimi 2/1", unit: [[1, 1, 0], [0, 1, 1], [1, 0, 1]] },
  { id: "twill22", label: "Dimi 2/2", unit: [[1, 1, 0, 0], [0, 1, 1, 0], [0, 0, 1, 1], [1, 0, 0, 1]] },
  { id: "twill13", label: "Dimi 1/3", unit: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
  // 4'lü saten düzenli olamaz (kırık dimi düzeni 1-2-4-3); 5'li saten 2 atlamalı.
  { id: "satin4", label: "4'lü saten (kırık)", unit: satin([0, 1, 3, 2]) },
  { id: "satin5", label: "5'li saten", unit: satin([0, 2, 4, 1, 3]) },
  { id: "basket22", label: "Panama 2/2", unit: [[1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 1, 1], [0, 0, 1, 1]] },
];

export const templateById = (id: WeaveTemplateId): WeaveTemplate => WEAVE_TEMPLATES.find((t) => t.id === id)!;

/**
 * Şablonu aralığa basar. `skipFrames` (0-tabanlı, döner çerçeveler) atlanır ve DOKUNULMAZ; şablon kalan
 * çerçevelerde sırayla döşenir, atkı sayacı aralığın ilk atkısından başlar.
 */
export function applyTemplate(plan: LiftPlan, unit: Block, rect: Rect, skipFrames: ReadonlySet<number> = new Set()): LiftPlan {
  const h = unit.length;
  const w = unit[0]?.length ?? 0;
  if (h === 0 || w === 0) return plan;
  const cols: number[] = [];
  for (let c = rect.c0; c <= rect.c1; c++) if (!skipFrames.has(c)) cols.push(c);
  if (cols.length === 0) return plan;
  return plan.map((row, r) => {
    if (r < rect.r0 || r > rect.r1) return row;
    let next: number[] | null = null;
    cols.forEach((c, k) => {
      const v = unit[(r - rect.r0) % h]![k % w]!;
      if (c < row.length && row[c] !== v) {
        next ??= row.slice();
        next[c] = v;
      }
    });
    return next ?? row;
  });
}

// ---------------------------------------------------------------------------
// Satır (atkı) / sütun (çerçeve) ekle-sil — döner çerçeve numaraları (1-tabanlı) birlikte kayar.
// ---------------------------------------------------------------------------

/** `at` konumuna (0-tabanlı, o satırın önüne) boş atkı ekler; tavanı aşan kısım eklenmez. */
export function insertPicks(plan: LiftPlan, at: number, count = 1): LiftPlan {
  const n = Math.max(0, Math.min(count, LIFT_PLAN_MAX_PICKS - plan.length));
  const f = frameCountOf(plan);
  if (n === 0 || f === 0) return plan;
  const pos = Math.max(0, Math.min(at, plan.length));
  const blank = Array.from({ length: n }, () => new Array<number>(f).fill(0));
  return [...plan.slice(0, pos), ...blank, ...plan.slice(pos)];
}

/** r0..r1 atkılarını siler. */
export function deletePicks(plan: LiftPlan, r0: number, r1: number): LiftPlan {
  if (r1 < r0 || r0 >= plan.length) return plan;
  return [...plan.slice(0, Math.max(0, r0)), ...plan.slice(r1 + 1)];
}

/** `at` konumuna (0-tabanlı çerçeve indisi) boş çerçeve ekler. */
export function insertFrames(plan: LiftPlan, at: number, count = 1): LiftPlan {
  const f = frameCountOf(plan);
  const n = Math.max(0, Math.min(count, LIFT_PLAN_MAX_FRAMES - f));
  if (n === 0 || plan.length === 0) return plan;
  const pos = Math.max(0, Math.min(at, f));
  const blank = new Array<number>(n).fill(0);
  return plan.map((row) => [...row.slice(0, pos), ...blank, ...row.slice(pos)]);
}

/** c0..c1 çerçevelerini siler (son çerçeve de silinirse ızgara boşalır). */
export function deleteFrames(plan: LiftPlan, c0: number, c1: number): LiftPlan {
  const f = frameCountOf(plan);
  if (c1 < c0 || c0 >= f) return plan;
  if (c0 <= 0 && c1 >= f - 1) return [];
  return plan.map((row) => [...row.slice(0, Math.max(0, c0)), ...row.slice(c1 + 1)]);
}

/** Çerçeve eklenince döner numaraları: eklenen yerin sağındakiler `count` kayar. */
export function lenoAfterInsertFrames(leno: readonly number[], at: number, count: number): number[] {
  return leno.map((f) => (f - 1 >= at ? f + count : f));
}

/** Çerçeve silinince döner numaraları: silinenler düşer, sağdakiler sola kayar. */
export function lenoAfterDeleteFrames(leno: readonly number[], c0: number, c1: number): number[] {
  const n = c1 - c0 + 1;
  return leno.filter((f) => f - 1 < c0 || f - 1 > c1).map((f) => (f - 1 > c1 ? f - n : f));
}

// ---------------------------------------------------------------------------
// Geri al / yinele yığını
// ---------------------------------------------------------------------------

export const HISTORY_LIMIT = 100;

export interface History<T> { past: T[]; present: T; future: T[] }

export const historyInit = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** Yeni durum: öncekini geçmişe atar, yinele kuyruğu boşalır. Aynı nesne gelirse değişmez. */
export function historyPush<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

/** Sürükleme sırasında ara durum: geçmişe yazılmaz (bırakınca `historyCommitFrom`). */
export const historyReplace = <T>(h: History<T>, next: T): History<T> => (next === h.present ? h : { ...h, present: next });

/** Sürükleme bitti: başlangıç durumu tek geri al adımı olur (hiç değişmediyse iz bırakmaz). */
export function historyCommitFrom<T>(h: History<T>, base: T, limit = HISTORY_LIMIT): History<T> {
  if (base === h.present) return h;
  return { past: [...h.past, base].slice(-limit), present: h.present, future: [] };
}

export function historyUndo<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: rest };
}
