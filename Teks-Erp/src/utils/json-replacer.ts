import { Prisma } from "@prisma/client";

/**
 * Prisma `Decimal` instance'larının JSON serileştirmesini number olarak yapar.
 *
 * Sorun: decimal.js'in default `toJSON()`'u string döndürür (`"5.50"`). Express
 * `json replacer` setting'i de işe yaramaz çünkü `JSON.stringify` algoritması
 * `toJSON()`'u replacer'dan ÖNCE çağırır — replacer'a değer string olarak gelir,
 * `Prisma.Decimal.isDecimal(string)` false döner, hiçbir dönüşüm yapılmaz.
 *
 * Çözüm: `Decimal.prototype.toJSON`'u override et — number döndürsün. Tek seferlik
 * monkey-patch; tüm `JSON.stringify` çağrılarında (Express `res.json` dahil)
 * geçerli olur.
 *
 * Hassasiyet: tekstil metraj/ağırlık değerleri (genelde 4-5 anlamlı basamak)
 * IEEE 754 double'a kayıpsız sığar. Para birimi gibi precision-kritik alanlar
 * olursa bu noktada özel bir karar gerekir; şu an domain'de yok.
 */
let patched = false;
export function installDecimalNumberSerializer(): void {
  if (patched) return;
  (Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON =
    function (this: Prisma.Decimal) {
      return Number(this);
    };
  patched = true;
}

/**
 * Eski API geri uyumluluğu — `app.set("json replacer", ...)` ile kullanılır.
 * Artık no-op (toJSON patch'i gerçek dönüşümü yapıyor); sadece import zincirleri
 * için tutulur. Yeni kod doğrudan `installDecimalNumberSerializer()` çağırsın.
 */
export function decimalJsonReplacer(_key: string, value: unknown): unknown {
  return value;
}
