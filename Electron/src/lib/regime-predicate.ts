// =============================================================================
// BAYRAK ALANI → GÖRÜNÜRLÜK YÜKLEMİ (tek dönüştürücü)
// =============================================================================
// Bazı katalog satırları kuralı bir FONKSİYON olarak değil, bir ALAN ADI olarak
// yazıyor: `NavItem.featureFlag` ve `ReportTile.featureFlag`. Bu iki katalog
// hub karolarına ait değil (menü satırı ve rapor kategorisi) ve orada saf yüklem
// dosyası açmak, tek satırlık bir kural için altı dosya demekti.
//
// NEDEN AYRI BİR DOSYA VE NEDEN ÖNBELLEKLİ:
// Komut paleti, karo yüklemlerini KOPYALAMAZ TAŞIR ve bekçi bunu `toBe` ile
// (fonksiyon KİMLİĞİ) ölçer. Alan adından her çağrıda YENİ bir ok fonksiyonu
// üretilseydi aynı menü satırı için palet ve menü farklı nesneler taşırdı;
// bugün bir testi kırmasa da "kopyalanmış ikinci kural" desenini geri getirirdi.
// Önbellek, alan adı başına TEK yüklem nesnesi garanti eder.
//
// ⚠️ KARAR BAĞLAMDAN OKUNUR, `useFeatureFlags()`TEN DEĞİL. Sebep varsayılanların
// YÖNÜ: `production.enabled` belirsizken AÇIK, diğer modüller KAPALI sayılır ve
// `iplikEnabled` bağlamda ETKİN değeri (`ticaret && iplik`) taşır. Zinciri ve
// varsayılanları çözen TEK yer `useOperationsVisibilityContext`tir; burada
// yalnız alan okunur.
// =============================================================================
import type { OperationsVisibilityContext } from "@/pages/Operations/tile-config";

/**
 * Bağlamdaki BOOLEAN alanların adları — sayısal/başka tipte bir alan eklenirse
 * bu tip onu kendiliğinden dışarıda bırakır (bağlamda sayaç zaten yasak:
 * `tile-visibility.test`).
 */
export type RegimeFlagField = {
  [K in keyof OperationsVisibilityContext]: OperationsVisibilityContext[K] extends boolean
    ? K
    : never;
}[keyof OperationsVisibilityContext];

const cache = new Map<RegimeFlagField, (ctx: OperationsVisibilityContext) => boolean>();

/** Alan adı → o alanı okuyan SAF yüklem (alan başına tek nesne). */
export function regimePredicate(
  field: RegimeFlagField,
): (ctx: OperationsVisibilityContext) => boolean {
  const hit = cache.get(field);
  if (hit) return hit;
  const fn = (ctx: OperationsVisibilityContext): boolean => ctx[field];
  cache.set(field, fn);
  return fn;
}
