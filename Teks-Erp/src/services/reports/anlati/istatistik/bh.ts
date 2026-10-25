// =============================================================================
// Benjamini-Hochberg — çok grup tek tek tarandığında "tesadüfen biri çıkar" düzeltmesi
// =============================================================================
// Vardiya/tezgah gibi bir boyutun her değeri "diğerleriyle" ayrı ayrı kıyaslanır; düzeltmesiz
// 20 tezgahtan biri şans eseri "kanıtlı" görünürdü (plan §3.8, §7 risk 4).

/** Girdi sırasıyla düzeltilmiş olasılıklar (q); NaN girdi NaN kalır ve sıralamaya katılmaz. */
export function benjaminiHochberg(pValues: readonly number[]): number[] {
  const idx = pValues.map((p, i) => ({ p, i })).filter((e) => Number.isFinite(e.p));
  const m = idx.length;
  idx.sort((a, b) => a.p - b.p || a.i - b.i);
  const out = pValues.map(() => NaN);
  let running = 1;
  for (let k = m - 1; k >= 0; k--) {
    const e = idx[k]!;
    running = Math.min(running, (e.p * m) / (k + 1));
    out[e.i] = Math.min(1, running);
  }
  return out;
}
