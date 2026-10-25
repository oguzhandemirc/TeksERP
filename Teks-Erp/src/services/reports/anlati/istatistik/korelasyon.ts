// =============================================================================
// Pearson ve Spearman — iki ölçünün birlikte değişimi (R3-ISTAT; plan §3.8)
// =============================================================================
// Katsayı `simple-statistics`ten; anlamlılık t = r·√((n−2)/(1−r²)), df = n−2 (kendi `dagilim.ts`).
// Spearman sıraları eşitlikte ORTALAMA sıra alır (scipy `spearmanr` ile aynı).

import { sampleCorrelation } from "simple-statistics";
import { studentTTwoSided } from "./dagilim";
import { sampleWarnings, type TestResult } from "./tipler";

function correlationTest(r: number, n: number): TestResult {
  const df = n - 2;
  let t = NaN;
  let p = NaN;
  if (df > 0 && Number.isFinite(r)) {
    // |r| = 1 → t sonsuz; olasılık 0 (tam doğrusal).
    t = Math.abs(r) >= 1 ? Math.sign(r) * Infinity : r * Math.sqrt(df / (1 - r * r));
    p = Number.isFinite(t) ? studentTTwoSided(t, df) : 0;
  }
  return { istatistik: r, df, p, n, etkiBuyuklugu: r, enKucukBeklenen: null, uyarilar: sampleWarnings(n, null) };
}

function assertPairs(x: readonly number[], y: readonly number[]): void {
  if (x.length !== y.length) throw new Error("korelasyon: x ve y aynı uzunlukta olmalı");
}

/** Pearson; n < 3 ya da sabit seri → r NaN (ölçülemedi). */
export function pearson(x: readonly number[], y: readonly number[]): TestResult {
  assertPairs(x, y);
  const n = x.length;
  let r = NaN;
  if (n >= 3) {
    try {
      r = sampleCorrelation([...x], [...y]);
    } catch {
      r = NaN;
    }
  }
  return correlationTest(r, n);
}

/** Ortalama sıralar (1'den), eşit değerler aynı ortalama sırayı alır. */
export function averageRanks(values: readonly number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  for (let s = 0; s < order.length; ) {
    let e = s;
    while (e + 1 < order.length && order[e + 1]!.v === order[s]!.v) e++;
    const avg = (s + e) / 2 + 1;
    for (let k = s; k <= e; k++) ranks[order[k]!.i] = avg;
    s = e + 1;
  }
  return ranks;
}

export function spearman(x: readonly number[], y: readonly number[]): TestResult {
  assertPairs(x, y);
  return pearson(averageRanks(x), averageRanks(y));
}
