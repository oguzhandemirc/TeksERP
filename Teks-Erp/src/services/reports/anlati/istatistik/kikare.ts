// =============================================================================
// Ki-kare — çapraz tablo bağımsızlığı ve maruziyetli oran uyumu (R3-ISTAT; plan §3.8)
// =============================================================================
// Bağımsızlık: beklenen = satır·sütun/N, df = (r−1)(c−1), etki = Cramér V.
// Oran uyumu: her grubun beklenen sayısı N·(maruziyet payı), df = k−1 — "vardiyalar aynı hızda
// hata üretseydi" sorusu; sayımı ham değil üretime oranlanmış kıyaslar.

import { chiSquareSurvival } from "./dagilim";
import { sampleWarnings, type TestResult } from "./tipler";

export interface ContingencyResult extends TestResult {
  beklenen: number[][];
  /** Düzeltilmiş artık: (O−E)/√(E(1−r/N)(1−c/N)); |z| > 2 hücre "öne çıkan". */
  artiklar: number[][];
}

export function chiSquareTest(table: readonly (readonly number[])[]): ContingencyResult {
  const rows = table.length;
  const cols = rows ? table[0]!.length : 0;
  const rowSum = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colSum = Array.from({ length: cols }, (_, j) => table.reduce((a, r) => a + (r[j] ?? 0), 0));
  const n = rowSum.reduce((a, b) => a + b, 0);
  const beklenen = table.map((_, i) => colSum.map((c) => (n > 0 ? (rowSum[i]! * c) / n : 0)));
  // Boş satır/sütun serbestlik derecesine sayılmaz (beklenen 0 → bölme yok).
  const liveRows = rowSum.filter((s) => s > 0).length;
  const liveCols = colSum.filter((s) => s > 0).length;
  const df = (liveRows - 1) * (liveCols - 1);
  let stat = 0;
  let minExpected = Infinity;
  const artiklar = table.map((r, i) =>
    r.map((o, j) => {
      const e = beklenen[i]![j]!;
      if (e <= 0) return 0;
      stat += ((o - e) * (o - e)) / e;
      minExpected = Math.min(minExpected, e);
      const v = e * (1 - rowSum[i]! / n) * (1 - colSum[j]! / n);
      return v > 0 ? (o - e) / Math.sqrt(v) : 0;
    }),
  );
  const ok = df > 0 && n > 0;
  const k = Math.min(liveRows, liveCols);
  const cramerV = ok && k > 1 ? Math.sqrt(stat / (n * (k - 1))) : null;
  const minE = Number.isFinite(minExpected) ? minExpected : null;
  return {
    istatistik: ok ? stat : NaN,
    df,
    p: ok ? chiSquareSurvival(stat, df) : NaN,
    n,
    etkiBuyuklugu: cramerV,
    enKucukBeklenen: minE,
    uyarilar: sampleWarnings(n, minE),
    beklenen,
    artiklar,
  };
}

/** Maruziyetli uyum: gözlenen sayılar maruziyet payına göre dağılıyor mu? Maruziyet > 0 olmalı. */
export function rateGoodnessOfFit(counts: readonly number[], exposures: readonly number[]): TestResult {
  const n = counts.reduce((a, b) => a + b, 0);
  const e = exposures.reduce((a, b) => a + b, 0);
  const df = counts.length - 1;
  let stat = 0;
  let minExpected = Infinity;
  counts.forEach((o, i) => {
    const exp = e > 0 ? (n * exposures[i]!) / e : 0;
    if (exp <= 0) return;
    stat += ((o - exp) * (o - exp)) / exp;
    minExpected = Math.min(minExpected, exp);
  });
  const ok = df > 0 && n > 0 && e > 0;
  const minE = Number.isFinite(minExpected) ? minExpected : null;
  return { istatistik: ok ? stat : NaN, df, p: ok ? chiSquareSurvival(stat, df) : NaN, n, etkiBuyuklugu: null, enKucukBeklenen: minE, uyarilar: sampleWarnings(n, minE) };
}
