// =============================================================================
// GERÇEKÇİLİK EŞİĞİ — UYARI, BLOK DEĞİL
// =============================================================================
// Yanlış ölçekli bir cihaz (gram ölçen kantara `scale=1`) ağırlığı/metrajı 1000
// kat şişirir ve bu sayı SEVK İRSALİYESİNE basılır. Eşik o sayıyı sessiz
// geçirmemek içindir.
//
// ⚠️ NEDEN BLOK DEĞİL: ağırlık ÜÇ yoldan giriyor (kantar · elle giriş ·
// simülasyon). Sert tavan konulursa meşru bir yük de reddedilir ve o gün kapı
// kaldırılır; uyarı her yolda çalışır ve kimseyi durdurmaz.
// ⚠️ NEDEN ZOD'DA DEĞİL: doğrulama katmanı İKİLİDİR (geçer/geçmez); burada
// gereken üçüncü hâl "geçer ama söyler"dir. Serviste durduğu için üç giriş yolu
// tek yerden kapsanır.
// =============================================================================

/** Çuval brüt ağırlığı için gerçekçilik eşiği (kg). */
export const WEIGHT_WARN_KG = 1_000;

/** Top metrajı için gerçekçilik eşiği (m). */
export const LENGTH_WARN_M = 10_000;

/** Eşik aşıldıysa operatöre gösterilecek metin, aşılmadıysa `null`. */
export function weightWarning(kg: number): string | null {
  if (!(kg > WEIGHT_WARN_KG)) return null;
  return `${kg} kg gerçekçi görünmüyor (eşik ${WEIGHT_WARN_KG} kg). Kantar gram ölçüyorsa Cihaz Kaydı'ndaki Ölçek 0,001 olmalı.`;
}

/** Eşik aşıldıysa operatöre gösterilecek metin, aşılmadıysa `null`. */
export function lengthWarning(m: number): string | null {
  if (!(m > LENGTH_WARN_M)) return null;
  return `${m} m gerçekçi görünmüyor (eşik ${LENGTH_WARN_M} m). Cihazın ham birimi cm ise Ölçek 0,01 olmalı.`;
}
