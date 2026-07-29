// =============================================================================
// Saha #13 — ürün/renk adı standartları + ad-mükerrer karşılaştırma katlamaları
// =============================================================================
// Ürün (kumaş) adları: HEPSİ BÜYÜK (tr locale — i→İ doğru dönsün). Boşluk KORUNUR.
// Renk adları: BÜYÜK + SAYI BLOKLARI BAŞTA + boşluk KORUNUR (2026-07-27: eski
// standart boşluğu tireye çeviriyordu — "krem gümüş" → "KREM-GÜMÜŞ"; saha renk
// adında boşluk istedi). Tire ayracına ARTIK dokunulmaz: canlıda "055-BEYAZ"
// biçiminde tireli kayıtlar var; yeniden kaydetmek adı değiştirmemeli.
//   "beyaz 055"   → "055 BEYAZ"
//   "krem gümüş"  → "KREM GÜMÜŞ"
//   "055-BEYAZ"   → "055-BEYAZ" (legacy, idempotent)
// Mükerrer kontrolü fold* fonksiyonlarıyla ayraç-duyarsız yapılır — eski tireli
// kayıtla yeni boşluklu yazım aynı anahtara düşer, görünmez mükerrer doğmaz.
// =============================================================================

/** Ürün adı: trim + çoklu boşluk tekle + Türkçe büyük harf. Boşluklar KORUNUR. */
export function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

/**
 * Renk adı: Türkçe büyük harf, boşluk token'ları, SALT-RAKAM token'lar başa
 * (kendi sıralarıyla), TEK BOŞLUK ile birleşir. Tire içeren token bölünmez;
 * boşlukla ayrık YALNIZ-TİRE token'lar düşer ("açık - mavi 03" → "03 AÇIK MAVİ").
 */
export function normalizeColorName(name: string): string {
  const tokens = name
    .trim()
    .toLocaleUpperCase("tr-TR")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !/^-+$/.test(t));
  if (tokens.length === 0) return "";
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  const rest = tokens.filter((t) => !/^\d+$/.test(t));
  return [...numeric, ...rest].join(" ");
}

/**
 * Genel ad karşılaştırma anahtarı (mükerrer kontrolü): trim + çoklu boşluk
 * tekle + tr-TR BÜYÜK. "Mavi" / "MAVİ" / " mavi " aynı anahtara düşer.
 * Depolanan adı DEĞİŞTİRMEZ — yalnız karşılaştırmada kullanılır. PG lower()
 * İ/ı harflerinde hatalı olduğundan (ILIKE/mode:'insensitive' "MAVİ"≠"mavi"
 * sayar) karşılaştırma her zaman JS tarafında bu katlamayla yapılır.
 */
export function foldNameForCompare(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

/**
 * Renk adı karşılaştırma anahtarı: ayraçlar (boşluk/tire) eşdeğer + salt-rakam
 * bloklar başta. "055-BEYAZ" (legacy) ≡ "055 BEYAZ" ≡ "beyaz 055".
 */
export function foldColorNameForCompare(name: string): string {
  const tokens = name
    .trim()
    .toLocaleUpperCase("tr-TR")
    .split(/[\s-]+/)
    .filter(Boolean);
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  const rest = tokens.filter((t) => !/^\d+$/.test(t));
  return [...numeric, ...rest].join(" ");
}
