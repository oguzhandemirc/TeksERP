/**
 * OKUTULAN KODU DEPOLANMIŞ BİÇİME ÇEVİRİR — mobil tarafın tek kapısı.
 *
 * SAHA VAKASI (2026-08-17): kâğıda BÜYÜK harfle basılan barkod, el tarayıcısından
 * KÜÇÜK harf geliyordu (klavye-taklidi düzen / Caps Lock inversiyonu). Sunucudaki
 * ARAMA yolu bu tarihte düzeltildi (`normalizeScanCode`, backend), yani top artık
 * her hâlükârda BULUNUYOR.
 *
 * Bu dosya İKİNCİ ve daha sessiz sınıfı kapatır: **istemcide yapılan yerel
 * karşılaştırmalar**. Sunucu topu bulup BÜYÜK harfli barkoduyla döndürüyor, ekran
 * ise operatörün okuttuğu HAM metinle karşılaştırıyordu:
 *   • "bu top zaten listede" kontrolü tutmaz → aynı top listeye İKİ KEZ girer,
 *     mükerrer uyarısı hiç çıkmaz (operatör farkı göremez),
 *   • basılan etiketin geri-okutma doğrulaması "bilinmeyen kod" der.
 *
 * ⚠️ `toLocaleUpperCase("tr")` KULLANMA: "i" → "İ" üretir ve ASCII barkodu bozar.
 * Kod kalıbımızda Türkçe harf yok (İE/SIP/CV/T + tarih + sıra).
 *
 * ⚠️ Yalnız KOD alanlarına uygulanır (barkod, kart no, çuval no) — operatör notu
 * gibi serbest metni büyütmek veriyi bozar.
 */
export function normalizeScanCode(raw: string): string {
  return raw.trim().toUpperCase();
}
