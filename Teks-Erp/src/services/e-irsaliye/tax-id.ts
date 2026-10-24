// =============================================================================
// VKN / TCKN sağlaması — TEK KAYNAK (e-İrsaliye XML doğrulayıcısı + hazırlık kapısı).
// Cari kartındaki biçim kontrolü (customer.service `validateTaxNumber`) yalnız hane
// sayısına bakar; e-belgede geçersiz kimlik GİB'de reddedilir, o yüzden burada
// sağlama hanesi de ölçülür. Saf fonksiyonlar — DB'ye inmez.
// =============================================================================

/**
 * Vergi Kimlik Numarası (10 hane) sağlaması.
 * Algoritma (GİB VKN sağlaması, kamuya açık anlatım): ilk 9 hanenin her biri için
 * `t = (d_i + 10 - i) % 10`; `t === 9` ise katkı 9, değilse `(t · 2^(10-i)) % 9`.
 * Son hane = `(10 - Σ % 10) % 10`.
 * ⚠ doğrulanacak: algoritma GİB'in resmî tarifiyle (V1) teyit edilmedi; altın
 * örnekler ve bekçideki bilinen-geçerli numaralar bu anlatıma göre üretildi.
 */
export function isValidVkn(value: string): boolean {
  if (!/^[0-9]{10}$/.test(value)) return false;
  const d = value.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const t = (d[i]! + 9 - i) % 10; // i sıfır tabanlı: (d + 10 - (i+1)) % 10
    if (t === 9) {
      sum += 9;
      continue;
    }
    sum += (t * 2 ** (9 - i)) % 9;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

/**
 * T.C. Kimlik Numarası (11 hane) sağlaması (NVİ'nin kamuya açık algoritması):
 * ilk hane 0 olamaz; 10. hane = ((tek sıradakiler·7) − çift sıradakiler) mod 10;
 * 11. hane = ilk 10 hanenin toplamı mod 10.
 */
export function isValidTckn(value: string): boolean {
  if (!/^[1-9][0-9]{10}$/.test(value)) return false;
  const d = value.split("").map(Number);
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!;
  const even = d[1]! + d[3]! + d[5]! + d[7]!;
  const tenth = (((odd * 7 - even) % 10) + 10) % 10;
  if (tenth !== d[9]) return false;
  const first10 = d.slice(0, 10).reduce((a, b) => a + b, 0);
  return first10 % 10 === d[10];
}

/** 10 hane → VKN, 11 hane → TCKN; başka uzunluk e-İrsaliye'de kimlik değildir. */
export type TaxIdKind = "VKN" | "TCKN";

export function taxIdKind(value: string): TaxIdKind | null {
  if (/^[0-9]{10}$/.test(value)) return "VKN";
  if (/^[0-9]{11}$/.test(value)) return "TCKN";
  return null;
}

/** Türü + sağlamayı birlikte ölçer; çağıran tek soruyla "geçerli kimlik mi" öğrenir. */
export function isValidTaxId(value: string): boolean {
  const kind = taxIdKind(value);
  if (kind === "VKN") return isValidVkn(value);
  if (kind === "TCKN") return isValidTckn(value);
  return false;
}
