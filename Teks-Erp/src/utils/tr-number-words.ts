// =============================================================================
// Türkçe sayı yazısı — tam sayının sözcükleri ("bin iki yüz otuz dört")
// =============================================================================
// Belge şablonunun `yaziyla` filtresi (tutar yazıyla) bunu kullanır. Türkçe kural:
// "bir yüz"/"bir bin" söylenmez (yüz, bin), ama "bir milyon" söylenir.
// ⚠️ Rapor anlatı motorunda (R0-ANLATI, `reports/anlati/sayi-okunus.ts`) aynı çekirdek var;
// hangisi ikinci inerse bu dosyaya bağlanır (tek kaynak).

const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"] as const;
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"] as const;
const SCALES = ["", "bin", "milyon", "milyar", "trilyon"] as const;

/** Okunabilen en büyük tam sayı + 1 (katrilyon yok). */
export const TR_NUMBER_WORDS_LIMIT = 1_000_000_000_000_000;

function threeDigitWords(n: number): string[] {
  const hundreds = Math.floor(n / 100);
  const tens = Math.floor((n % 100) / 10);
  const ones = n % 10;
  const out: string[] = [];
  if (hundreds > 0) {
    if (hundreds > 1) out.push(ONES[hundreds]!);
    out.push("yüz");
  }
  if (tens > 0) out.push(TENS[tens]!);
  if (ones > 0) out.push(ONES[ones]!);
  return out;
}

/** Negatif olmayan tam sayının sözcükleri; 0 → ["sıfır"]. Sınır dışı ya da tam sayı değilse `null`. */
export function integerWordsTr(n: number): string[] | null {
  if (!Number.isSafeInteger(n) || n < 0 || n >= TR_NUMBER_WORDS_LIMIT) return null;
  if (n === 0) return ["sıfır"];
  const groups: number[] = [];
  for (let k = n; k > 0; k = Math.floor(k / 1000)) groups.push(k % 1000);
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]!;
    if (g === 0) continue;
    // "bir bin" denmez; "bir milyon" denir.
    if (!(i === 1 && g === 1)) out.push(...threeDigitWords(g));
    if (i > 0) out.push(SCALES[i]!);
  }
  return out;
}
