// =============================================================================
// Analiz sonucu sözleşmesi + örneklem eşikleri (R3-ISTAT)
// =============================================================================
// Eşikler TEK yerde: kart, anlatı ve bekçi aynı sayıyı okur. Altında kanıt cümlesi KURULMAZ.

/** Bundan az kayıtla "kanıt" denmez (plan §3.8). */
export const MIN_SAMPLE = 30;
/** Ki-kare tablosunda beklenen hücre bundan küçükse yaklaşık hesap güvenilmez. */
export const MIN_EXPECTED_CELL = 5;

export type SampleWarning = "azOrnek" | "kucukBeklenen";

/** Tel anahtarları Türkçe: kart sayıyı gösterir, cümle günlük dili kullanır. */
export interface TestResult {
  istatistik: number;
  df: number;
  p: number;
  n: number;
  etkiBuyuklugu: number | null;
  enKucukBeklenen: number | null;
  uyarilar: SampleWarning[];
}

export function sampleWarnings(n: number, minExpected: number | null): SampleWarning[] {
  const out: SampleWarning[] = [];
  if (n < MIN_SAMPLE) out.push("azOrnek");
  if (minExpected !== null && minExpected < MIN_EXPECTED_CELL) out.push("kucukBeklenen");
  return out;
}
