// =============================================================================
// KUMAŞ GÖRÜNÜMÜ (drawdown) — armür planı + atkı seçiciden kare ızgara (kart görseli, 2026-11-22)
// =============================================================================
// Kural: tel i'nin çerçevesi = DÜZ TAHAR (zemin çerçeveleri sırayla, döner çerçeveler hariç); atkı j'de
// o çerçeve kalkıksa hücre çözgüdür (0), değilse atkı seçicisindeki iplik no'su (seçici yoksa 1).
// Döner (LENO) desen çizilmez: doup hareketi ızgarayla simüle edilemez. Panel/tablet aynaları aynı
// örneklerle parite testine bağlıdır. SAF; gösterim içindir, hesaba girmez.
// =============================================================================

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
  /** Atkı başına 1-tabanlı iplik satırı no; null = seçici yok. */
  pickSequence: readonly number[] | null;
  /** Çizilecek tel sayısı; varsayılan bir düz tahar raporu (zemin çerçeve sayısı). */
  ends?: number;
  /** Çizilecek atkı sayısı; varsayılan armür planı satır sayısı. */
  picks?: number;
}

export interface WeaveDrawdown {
  /** Düz tahar sırasıyla zemin çerçeveleri (1-tabanlı). */
  groundFrames: number[];
  /** Tel başına çerçeve no (1-tabanlı) — tahar şeridi. */
  threading: number[];
  /** [atkı][tel]: 0 = çözgü üstte, k > 0 = k. atkı ipliği görünür. */
  cells: number[][];
  ends: number;
  picks: number;
}

const clamp = (n: number, max: number): number => Math.max(1, Math.min(max, Math.floor(n)));

/** Desenin kumaş görünümü; LENO, boş armür ya da zemin çerçevesi yoksa null. */
export function computeDrawdown(input: DrawdownInput): WeaveDrawdown | null {
  if (input.kind === "LENO") return null;  const plan = input.liftPlan ?? [];
  if (plan.length === 0) return null;
  const frames = plan.reduce((m, r) => Math.max(m, r.length), 0);
  const leno = new Set(input.lenoFrames);
  const groundFrames: number[] = [];
  for (let f = 1; f <= frames; f++) if (!leno.has(f)) groundFrames.push(f);
  if (groundFrames.length === 0) return null;
  const ends = clamp(input.ends ?? groundFrames.length, DRAWDOWN_MAX_ENDS);
  const picks = clamp(input.picks ?? plan.length, DRAWDOWN_MAX_PICKS);
  const seq = input.pickSequence && input.pickSequence.length > 0 ? input.pickSequence : null;
  const threading = Array.from({ length: ends }, (_, i) => groundFrames[i % groundFrames.length]!);
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
