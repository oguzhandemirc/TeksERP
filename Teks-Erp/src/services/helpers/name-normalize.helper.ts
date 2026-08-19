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
import { foldSearchText } from "../../utils/search-fold";

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
 * Genel ad karşılaştırma anahtarı (mükerrer kontrolü) — 2026-08-19'da ARAMA
 * KATLAMASIYLA BİRLEŞTİRİLDİ: `foldSearchText` ile birebir aynı, yani SQL
 * `public.tr_fold()` ile de birebir aynı.
 *
 * DAVRANIŞ DEĞİŞİKLİĞİ (kullanıcı kararı D3): artık "ŞAHİN" ile "SAHIN" AYNI
 * kayıt sayılır. Sahada aynı firma üç yazımla giriliyordu ve mükerrer
 * görünmüyordu; sadece büyük/küçük katlamak bunun yalnız bir bölümünü yakalıyordu
 * (ölçüldü: canlı veride 'ACTIVO' + 'ACTİVO' ve 'Moda Tekstil' + 'MODA TEKSTİL'
 * yan yana duruyor).
 *
 * ⚠️ ESKİ INVARIANT ("çıktısı `normalizeDisplayName` ile BİREBİR AYNI olmalı")
 * KALKTI — ama zayıflayarak değil, YAPISALLAŞARAK. Artık anahtar DB'de
 * `<kolon>Fold` GENERATED kolonu olarak DEPOLANAN DEĞERDEN TÜRETİLİYOR
 * (`GENERATED ALWAYS AS (public.tr_fold(name)) STORED`). Yani "depolanan biçim
 * ile mükerrer anahtarı ayrışabilir" ihtimali artık mümkün değil: ikisini elle
 * hizada tutmak yerine PostgreSQL türetiyor. Depolama BÜYÜK harf olmaya devam
 * eder (`normalizeDisplayName`), anahtar küçük ASCII'dir; ikisi FARKLI olmalıdır
 * ve bu bir hata değil, ayrımın kendisidir.
 */
export function foldNameForCompare(name: string): string {
  return foldSearchText(name);
}

/**
 * Renk adı karşılaştırma anahtarı: ayraçlar (boşluk/tire) eşdeğer + salt-rakam
 * bloklar başta. "055-BEYAZ" (legacy) ≡ "055 BEYAZ" ≡ "beyaz 055".
 *
 * ⚠️ Renk BİLİNÇLİ olarak DB `nameFold` kolonuna bağlanmadı: bu katlama ayraç
 * ve token sırasından bağımsızdır, `tr_fold` ise değildir. Karşılaştırma JS'te
 * kalır (renk kataloğu onlarca satır). Taban katlama yine ortaktır — yani
 * "BEYAZ" ile "beyaz" gibi "SAHIN" ile "ŞAHİN" de aynı anahtara düşer.
 */
export function foldColorNameForCompare(name: string): string {
  const tokens = foldSearchText(name)
    .split(/[\s-]+/)
    .filter(Boolean);
  const numeric = tokens.filter((t) => /^\d+$/.test(t));
  const rest = tokens.filter((t) => !/^\d+$/.test(t));
  return [...numeric, ...rest].join(" ");
}
