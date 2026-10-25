// =============================================================================
// İki oran kıyası — "bu grup diğerlerinden farklı mı?" (R3-ISTAT; plan §3.8)
// =============================================================================
// İki örneklem oran testi (havuzlu z) ve maruziyetli sayım oranı testi (koşullu binom'un
// normal yaklaşığı). Olasılık z² ~ ki-kare(1) kuyruğundan; etki = oran oranı.

import { chiSquareSurvival } from "./dagilim";
import { sampleWarnings, type TestResult } from "./tipler";

/** x1/n1 ile x2/n2 aynı mı? (havuzlu z, iki yönlü). */
export function twoProportionTest(x1: number, n1: number, x2: number, n2: number): TestResult {
  const n = n1 + n2;
  const pooled = n > 0 ? (x1 + x2) / n : NaN;
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const z = se > 0 ? (x1 / n1 - x2 / n2) / se : NaN;
  const minExpected = Math.min(n1 * pooled, n1 * (1 - pooled), n2 * pooled, n2 * (1 - pooled));
  return {
    istatistik: z,
    df: 1,
    p: Number.isFinite(z) ? chiSquareSurvival(z * z, 1) : NaN,
    n,
    etkiBuyuklugu: n2 > 0 && x2 > 0 ? x1 / n1 / (x2 / n2) : null,
    enKucukBeklenen: Number.isFinite(minExpected) ? minExpected : null,
    uyarilar: sampleWarnings(n, Number.isFinite(minExpected) ? minExpected : null),
  };
}

/**
 * c1 olay / e1 maruziyet ile c2 / e2 aynı hızda mı? Toplam N sabitken c1 ~ Binom(N, e1/(e1+e2)).
 * Etki = (c1/e1)/(c2/e2) ("2 katı").
 */
export function rateRatioTest(c1: number, e1: number, c2: number, e2: number): TestResult {
  const n = c1 + c2;
  const share = e1 + e2 > 0 ? e1 / (e1 + e2) : NaN;
  const expected = n * share;
  const v = n * share * (1 - share);
  const z = v > 0 ? (c1 - expected) / Math.sqrt(v) : NaN;
  const minExpected = Math.min(expected, n - expected);
  const okMin = Number.isFinite(minExpected) ? minExpected : null;
  return {
    istatistik: z,
    df: 1,
    p: Number.isFinite(z) ? chiSquareSurvival(z * z, 1) : NaN,
    n,
    etkiBuyuklugu: e1 > 0 && e2 > 0 && c2 > 0 ? c1 / e1 / (c2 / e2) : null,
    enKucukBeklenen: okMin,
    uyarilar: sampleWarnings(n, okMin),
  };
}
