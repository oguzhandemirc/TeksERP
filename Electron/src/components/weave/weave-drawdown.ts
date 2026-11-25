// Kumaş görünümü (drawdown) ve tahar şeridinin SAF hesabı — yalnız görünüm için; sunucu basımındaki
// `weave-drawdown.helper` ile aynı örnek tabloyu paylaşır (parite: `weave-drawdown.test.ts` DRAWDOWN_CASES).
// Kural: tel → çerçeve tahar türünün dizilimi (`weave-drawing-in`; tür yok/Özel → DÜZ TAHAR; döner ve kenar çerçeveleri
// hariç); atkı j'de telin çerçevesi kalkıksa hücre = çözgü (0), değilse o atkının ipliği (seçici; yoksa 1. iplik).
import { drawingInUnit, type DrawingInType } from "./weave-drawing-in";

/** Kumaş görünümü hücresi: 0 = çözgü üstte, k ≥ 1 = k. atkı ipliği üstte. */
export type DrawdownCell = number;

/** Kumaş görünümü tavanı — 512 atkı × 4 rapor çizimi tarayıcıyı yormasın diye satır sayısı kırpılır. */
export const DRAWDOWN_MAX_PICKS = 1024;

/** Zemin çerçevelerinin (döner ve kenar DIŞI) 0-tabanlı sütun indeksleri (sıralı). */
export function groundFrameIndexes(frameCount: number, lenoFrames: readonly number[] = [], selvedgeFrames: readonly number[] = []): number[] {
  const skip = new Set([...lenoFrames, ...selvedgeFrames]);
  return Array.from({ length: Math.max(0, frameCount) }, (_, c) => c).filter((c) => !skip.has(c + 1));
}

/** Düz tahar: tel i → çerçeve (0-tabanlı sütun). Zemin çerçevesi yoksa boş. */
export function straightDraw(ground: readonly number[], ends: number): number[] {
  if (ground.length === 0) return [];
  return Array.from({ length: Math.max(0, ends) }, (_, i) => ground[i % ground.length]!);
}

/** Bir tahar raporu: tel → çerçeve (0-tabanlı sütun), tür dizilimiyle (`drawingInUnit`); boş tür = düz. */
export function drawUnit(ground: readonly number[], type: DrawingInType | null | undefined): number[] {
  return drawingInUnit(ground.length, type).map((g) => ground[g]!);
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Desen raporu atkı sayısı: armür ile seçici raporunun EKOK'u (renk-örgü etkisi); tavanı aşarsa büyüğü. */
export function drawdownRepeatPicks(planPicks: number, seqLength: number, cap = 512): number {
  if (planPicks <= 0) return 0;
  if (seqLength <= 0) return planPicks;
  const lcm = (planPicks / gcd(planPicks, seqLength)) * seqLength;
  return lcm <= cap ? lcm : Math.max(planPicks, seqLength);
}

export interface DrawdownInput {
  liftPlan: readonly (readonly number[])[];
  lenoFrames?: readonly number[];
  /** Kenar çerçeveleri — zemin raporuna girmez (sunucu ikizi). */
  selvedgeFrames?: readonly number[];
  /** Atkı başına 1-tabanlı iplik no (sunucu `pickSequence`); null/boş = tek iplik. */
  pickSequence?: readonly number[] | null;
  /** Yatay/dikey rapor tekrarı (1×, 2×, 4×). */
  repeat?: number;
  /** Tahar türü (K1): Sivri/Atlamalı standart dizilim; boş/Düz/Özel = düz tahar (bugünkü çizim). */
  drawingInType?: DrawingInType | null;
}

export interface Drawdown {
  ends: number;
  picks: number;
  /** Tel i'nin çerçevesi (0-tabanlı). */
  draw: number[];
  /** cells[atkı][tel]. */
  cells: DrawdownCell[][];
}

export function computeDrawdown({ liftPlan, lenoFrames = [], selvedgeFrames = [], pickSequence, repeat = 1, drawingInType = null }: DrawdownInput): Drawdown {
  const frames = liftPlan.reduce((m, row) => Math.max(m, row.length), 0);
  const ground = groundFrameIndexes(frames, lenoFrames, selvedgeFrames);
  const rep = Math.max(1, Math.trunc(repeat));
  const seq = pickSequence && pickSequence.length > 0 ? pickSequence : null;
  const basePicks = drawdownRepeatPicks(liftPlan.length, seq?.length ?? 0);
  const picks = Math.min(basePicks * rep, DRAWDOWN_MAX_PICKS);
  const unit = drawUnit(ground, drawingInType);
  const draw = straightDraw(unit, unit.length * rep);
  const cells = Array.from({ length: picks }, (_, j) => {
    const row = liftPlan[j % liftPlan.length] ?? [];
    const weft = seq ? seq[j % seq.length]! : 1;
    return draw.map((frame) => (row[frame] === 1 ? 0 : weft));
  });
  return { ends: draw.length, picks, draw, cells };
}

/** Tahar şeridi: [çerçeve][tel] → 1 = tel bu çerçevenin gücüsünden geçer. */
export function threadingMatrix(frameCount: number, draw: readonly number[]): number[][] {
  return Array.from({ length: Math.max(0, frameCount) }, (_, f) => draw.map((d) => (d === f ? 1 : 0)));
}

/** Atkı raporunda iplik başına atkı sayısı (1-tabanlı iplik no → adet; dizi indeksi = no − 1). */
export function picksPerYarn(pickSequence: readonly number[], yarnCount: number): number[] {
  const counts = Array.from({ length: Math.max(0, yarnCount) }, () => 0);
  for (const n of pickSequence) if (n >= 1 && n <= counts.length) counts[n - 1] = (counts[n - 1] ?? 0) + 1;
  return counts;
}
