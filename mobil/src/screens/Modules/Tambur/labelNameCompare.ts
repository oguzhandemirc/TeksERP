// =============================================================================
// Basılacak ad ↔ bizdeki ad karşılaştırması — TEK KAYNAK (2026-08-19)
// =============================================================================
// Ayrı dosyada, çünkü kural saf ve sınanabilir olmalı: bileşenin içinde kalsaydı
// testi ya RN render'ı gerektirirdi ya da kuralın KOPYASINI sınardı (kopya sonda,
// ifade değişince sessizce eskir ve hiçbir şey yakalamaz).
// =============================================================================

export interface NamePair {
  /** Müşteri seçili mi — yoksa STOK baskısıdır, müşteriye özel ad basılmaz. */
  customerId: string | null;
  /** Etikete BASILACAK ad (zincirin çözdüğü). */
  itemName: string;
  /** BİZDEKİ ad (Item.name). */
  itemNameDefault: string;
  colorName: string | null;
  colorNameDefault: string | null;
}

/**
 * "Bizde: …" referans satırı çizilsin mi?
 *
 * Operatör müşteriye özel adı görüyor ama "bu aslında hangi kumaştı" sorusunun
 * cevabı ekranda yoktu — depoda/rafta kumaş BİZDEKİ adla duruyor.
 *
 * ⚠️ Kural İKİ YÖNLÜ: fark varsa çizilir, YOKSA çizilmez. İkinci yarısı kolayca
 * kaybolur ve kaybolduğunda özellik zarar verir — aynı ad alt alta iki kez
 * yazılınca operatör o satırı okumamayı öğrenir, sonra GERÇEK fark da gözden
 * kaçar.
 *
 * Kırpma bilinçli: baştaki/sondaki boşluk fark DEĞİLDİR (aynı adın iki yazımı).
 */
export function shouldShowOriginalName(p: NamePair): boolean {
  if (!p.customerId) return false; // STOK — karşılaştırılacak bir şey yok
  const itemDiffers = p.itemName.trim() !== p.itemNameDefault.trim();
  const colorDiffers = (p.colorName ?? '').trim() !== (p.colorNameDefault ?? '').trim();
  return itemDiffers || colorDiffers;
}
