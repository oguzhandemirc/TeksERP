/**
 * İki sürüm numarasını karşılaştırır: `a < b` ise negatif, eşitse 0, `a > b`
 * ise pozitif döner.
 *
 * Neden elle yazıldı (semver paketi yok): karşılaştırılan tek şey kendi
 * sürümümüz — `MAJOR.MINOR.PATCH`, her zaman üç sayı. Tam semver (ön-sürüm
 * etiketleri, build metadata, aralık sözdizimi) burada kullanılmıyor ve bu iş
 * için bir bağımlılık eklemek, taşınan riski azaltmadan yüzeyi büyütürdü.
 *
 * ⚠️ Parçalar SAYISAL karşılaştırılır. Sözlüksel karşılaştırma `2.10.0 < 2.9.0`
 * derdi — yani bir sonraki ondalık atlamada kilit sessizce ters çalışırdı.
 *
 * Sayıya çevrilemeyen parça 0 sayılır ve fazla parçalar yok sayılır: burada
 * "anlaşılmayan sürümü kilitle" davranışı YANLIŞ olurdu (bkz. `useClientPolicy`
 * fail-open notu).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    String(v ?? "")
      .trim()
      .split(".")
      .slice(0, 3)
      .map((p) => {
        const n = Number.parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
      });

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** `surum`, `enAz`ın altında mı? Girdilerden biri boşsa **false** (fail-open). */
export function isBelowMinimum(surum: string | null | undefined, enAz: string | null | undefined): boolean {
  if (!surum || !enAz) return false;
  return compareVersions(surum, enAz) < 0;
}
