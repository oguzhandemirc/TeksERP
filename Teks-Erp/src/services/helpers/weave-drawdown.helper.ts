// =============================================================================
// KUMAŞ GÖRÜNÜMÜ (drawdown) — armür planı + atkı seçiciden kare ızgara (kart görseli, 2026-11-22)
// =============================================================================
// Kural: tel i'nin çerçevesi = kumaşın tahar planı (T1; varsa) ya da tahar dizilimi (`drawingInUnit`: düz/sivri/atlamalı; döner ve kenar çerçeveleri hariç); atkı j'de
// o çerçeve kalkıksa hücre çözgüdür (0), değilse atkı seçicisindeki iplik no'su (seçici yoksa 1).
// Döner (LENO) desen çizilmez: doup hareketi ızgarayla simüle edilemez. Panel/tablet aynaları aynı
// örneklerle parite testine bağlıdır. SAF; gösterim içindir, hesaba girmez.
// =============================================================================

import { drawingInUnit, type WeaveDrawingInTypeValue } from "../../constants/weave-drawing-in";

export const DRAWDOWN_MAX_ENDS = 512;
export const DRAWDOWN_MAX_PICKS = 512;
/** Küçük görünüm (basım kutusu, küçük resim) penceresi: en az / en çok tel ve atkı. */
export const DRAWDOWN_WINDOW_MIN = 24;
export const DRAWDOWN_WINDOW_MAX = 64;

export interface DrawdownInput {
  /** Örgü (`weaveStructure`; eski `kind` da kabul) — "LENO" çizilmez. */
  kind: string | null;
  liftPlan: ReadonlyArray<ReadonlyArray<number>> | null;
  /** 1-tabanlı döner çerçeve no'ları. */
  lenoFrames: readonly number[];
  /** 1-tabanlı kenar çerçeve no'ları — zemin raporuna girmez (kenar teli rapor içinde tekrar etmez). */
  selvedgeFrames?: readonly number[];
  /** Atkı başına 1-tabanlı iplik satırı no; null = seçici yok. */
  pickSequence: readonly number[] | null;
  /** Tahar türü (K1): Sivri/Atlamalı standart dizilimle çizilir; boş/Düz/Özel = düz tahar (bugünkü çizim). */
  drawingInType?: WeaveDrawingInTypeValue | null;
  /** T1: kumaşın tahar planı (tel → 1-tabanlı çerçeve no). Doluysa türün yerine çizilir; desen örgüsünün
   *  çerçeve genişliğini aşan numara varsa yok sayılır (türden türetme — geri uyumlu). */
  threading?: readonly number[] | null;
  /** Çizilecek tel sayısı; varsayılan bir tahar raporu (`drawingInUnit` uzunluğu). */
  ends?: number;
  /** Çizilecek atkı sayısı; varsayılan armür planı satır sayısı. */
  picks?: number;
}

export interface WeaveDrawdown {
  /** Zemin çerçeveleri, numara sırasıyla (1-tabanlı). */
  groundFrames: number[];
  /** Tel başına çerçeve no (1-tabanlı) — tahar şeridi. */
  threading: number[];
  /** [atkı][tel]: 0 = çözgü üstte, k > 0 = k. atkı ipliği görünür. */
  cells: number[][];
  ends: number;
  picks: number;
}

const clamp = (n: number, max: number): number => Math.max(1, Math.min(max, Math.floor(n)));

/** Zemin çerçeveleri (1-tabanlı, sıralı): döner ve kenar DIŞI. */
export function groundFrameNumbers(frames: number, lenoFrames: readonly number[], selvedgeFrames: readonly number[] = []): number[] {
  const skip = new Set([...lenoFrames, ...selvedgeFrames]);
  const out: number[] = [];
  for (let f = 1; f <= frames; f++) if (!skip.has(f)) out.push(f);
  return out;
}

/** Kullanılabilir tahar planı dizisi (1-tabanlı); boşsa ya da örgü genişliğini aşıyorsa null → türden türet. */
export function planThreading(threading: readonly number[] | null | undefined, frames: number): number[] | null {
  if (!threading || threading.length === 0) return null;
  return threading.every((f) => Number.isInteger(f) && f >= 1 && f <= frames) ? [...threading] : null;
}

/** Desenin kumaş görünümü; LENO, boş armür ya da zemin çerçevesi yoksa null. */
export function computeDrawdown(input: DrawdownInput): WeaveDrawdown | null {
  if (input.kind === "LENO") return null;
  const plan = input.liftPlan ?? [];
  if (plan.length === 0) return null;
  const frames = plan.reduce((m, r) => Math.max(m, r.length), 0);
  const groundFrames = groundFrameNumbers(frames, input.lenoFrames, input.selvedgeFrames);
  if (groundFrames.length === 0) return null;
  const unit = planThreading(input.threading, frames) ?? drawingInUnit(groundFrames.length, input.drawingInType).map((g) => groundFrames[g]!);
  const ends = clamp(input.ends ?? unit.length, DRAWDOWN_MAX_ENDS);
  const picks = clamp(input.picks ?? plan.length, DRAWDOWN_MAX_PICKS);
  const seq = input.pickSequence && input.pickSequence.length > 0 ? input.pickSequence : null;
  const threading = Array.from({ length: ends }, (_, i) => unit[i % unit.length]!);
  const cells: number[][] = [];
  for (let j = 0; j < picks; j++) {
    const row = plan[j % plan.length]!;
    const weft = seq ? seq[j % seq.length]! : 1;
    cells.push(threading.map((f) => (row[f - 1] === 1 ? 0 : weft)));
  }
  return { groundFrames, threading, cells, ends, picks };
}

/**
 * Küçük görünüm penceresi: en az `min` tel/atkı olacak kadar tam rapor (tel = zemin çerçeve katı,
 * atkı = armür ile seçici raporlarının katı), `max` tavanıyla kırpılır.
 */
export function drawdownWindow(groundCount: number, planPicks: number, seqPicks: number): { ends: number; picks: number } {
  const min = DRAWDOWN_WINDOW_MIN;
  const max = DRAWDOWN_WINDOW_MAX;
  const fit = (unit: number): number => (unit <= 0 ? min : Math.min(max, unit * Math.max(1, Math.ceil(min / unit))));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const pickUnit = seqPicks > 0 && planPicks > 0 ? (planPicks / gcd(planPicks, seqPicks)) * seqPicks : planPicks;
  return { ends: fit(groundCount), picks: fit(pickUnit) };
}
