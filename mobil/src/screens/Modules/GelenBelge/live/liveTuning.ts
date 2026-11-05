// Canlı okuma (L3) ayarları — TEK YER. Oylama, istek ritmi ve otomatik çekim eşikleri buradan okunur; başka dosya
// sayı yazmaz. Native taraf sabitleri `mobil/modules/teks-erp-belge-tarayici/.../LiveTuning.kt`te.

/** Oylama penceresi: alanın son N yanıttaki değerleri sayılır. */
export const LIVE_VOTE_WINDOW = 5;
/** Kilit eşiği: aynı (normalize) değer pencerede en az K kez görülürse alan kilitlenir. */
export const LIVE_VOTE_QUORUM = 3;

/** İki kare isteği arasında en az bu kadar (~saniyede 1); uçuşta hep TEK istek. */
export const LIVE_REQUEST_INTERVAL_MS = 1000;

/**
 * Otomatik çekim için en düşük netlik (`onStability.sharpness`, parlaklık birimi 0–255). `LiveTuning.kt` netliği yalnız
 * ÖLÇER (`SHARPNESS_STEP`), eşik tanımlamaz; eşik bu JS sabitidir. Native'e eşik eklenirse aynı değer olmalı (bekçi
 * `liveTuning.test.ts`). Değer cihazda ölçülerek ayarlanacak (L4); düşük tutuldu: kaçan çekim "Şimdi çek"le alınır.
 */
export const LIVE_MIN_SHARPNESS = 3;

/** "Kıpırdatmayın" halkasının süresi: koşullar bu kadar kesintisiz sürerse fotoğraf çekilir. */
export const LIVE_HOLD_MS = 1500;
