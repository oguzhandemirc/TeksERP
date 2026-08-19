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

/**
 * GENEL AD NORMALİZASYONU — master-data adlarının DEPOLANAN biçimi (2026-08-19).
 *
 * Saha talebi: müşteri/kumaş/renk vb. HER ŞEY büyük harfle kaydedilsin. Sahada
 * aynı ad üç farklı yazımla giriliyor ("öz şahin", "Öz Şahin", "ÖZ ŞAHİN") ve
 * mükerrer görünmüyordu.
 *
 * ⚠️ ÇIKTISI `foldNameForCompare` İLE BİREBİR AYNI — bu tesadüf değil, kuralın
 * kendisi: depolanan biçim, mükerrer kontrolünün kullandığı anahtarla aynı
 * olmalı. Ayrışırlarsa "aynı ada izin verme" kontrolü kendi yazdığı kaydı
 * bulamaz hâle gelir. Bu ikisini birbirinden bağımsız değiştirme.
 *
 * ⚠️ `toLocaleUpperCase("tr")` ZORUNLU (düz `toUpperCase()` DEĞİL): "iplik" →
 * "İPLİK" olmalı, "IPLIK" değil. Ters uygulanırsa i-ailesi bozulur ve iki ayrı
 * kayıt doğar. (Barkod/kod tarafında kural TERSİDİR — orada ASCII beklenir,
 * bkz. `utils/code-format.normalizeScanCode`.)
 *
 * ⚠️ Title Case ("Öz Şahin") BİLİNÇLİ OLARAK SUNULMUYOR: Türkçede güvenilir
 * biçimde üretilemez ("ve", "A.Ş.", "12'li", kısaltmalar, i/ı ailesi) — her
 * kural bir istisna doğurur. Müşteri farklı görmek isterse çözüm depolama
 * biçimi değil, belge/render katmanıdır.
 */
export function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleUpperCase("tr-TR");
}

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
