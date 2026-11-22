// =============================================================================
// GÖVDE NO ESNEK EŞLEŞME — saf, bağımlılıksız (devere S3). BAYT-AYNI kopya: mobil/src/utils/beamBodyNo.ts
// =============================================================================
// Flanşa boyanmış/kazınmış numara sistemdekinden farklı yazılabilir ("12", "012", "LG-12", "lg 12").
// Anahtar: harf katla, sondaki rakam dizisinin baştaki sıfırlarını at, sonra boşluk . _ / - at. Yalnız rakamdan
// oluşan okuma ön ekli gövdenin sondaki numarasıyla da eşleşir ("12" ↔ "LG-0012"); birden çok aday çağıranın işidir.
// =============================================================================

const stripZeros = (d: string): string => d.replace(/^0+(?=\d)/, "");

/** Normalize anahtar: "LG-012" → "lg12", " 0012 " → "12", "A1-007" → "a17". */
export function beamBodyNoKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\d+$/, stripZeros).replace(/[\s._/-]+/g, "");
}

/** Sondaki rakam dizisi (sıfırsız) — "LG-0012" → "12"; rakamla bitmiyorsa null. */
function numericTail(raw: string): string | null {
  const m = /\d+$/.exec(raw.trim());
  return m ? stripZeros(m[0]) : null;
}

/** Okunan `input`, kayıtlı `bodyNo` ile esnek eşleşiyor mu (anahtar eşit ya da yalnız-rakam okuma = sondaki numara). */
export function beamBodyNoLooseMatch(input: string, bodyNo: string): boolean {
  const a = beamBodyNoKey(input);
  if (!a) return false;
  if (a === beamBodyNoKey(bodyNo)) return true;
  if (!/^\d+$/.test(a)) return false;
  return numericTail(bodyNo) === stripZeros(a);
}
