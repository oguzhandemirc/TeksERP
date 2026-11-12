// Canlı okuma (L3) ayarları — TEK YER. Oylama, istek ritmi ve otomatik çekim eşikleri buradan okunur; başka dosya
// sayı yazmaz. Native taraf sabitleri `mobil/modules/teks-erp-belge-tarayici/.../LiveTuning.kt`te.

/** Oylama penceresi: alanın son N yanıttaki değerleri sayılır. */
export const LIVE_VOTE_WINDOW = 5;
/** Kilit eşiği: aynı (normalize) değer pencerede en az K kez görülürse alan kilitlenir. */
export const LIVE_VOTE_QUORUM = 3;
/** Kendini düzelten kilit: oyla kilitlenmiş alanda pencerede kilitten FARKLI aynı değer en az bu kadar → kilit o değere geçer. */
export const LIVE_VOTE_RELOCK = 4;
/** "Düzeltildi" işaretinin kaç yanıt (~saniye) görüneceği. */
export const LIVE_CORRECTED_SHOW = 3;
/**
 * Oy sayılan en düşük kare netliği (`onStability.sharpness`). Altındaki karenin yanıtı oylamaya GİRMEZ (geçmişe hiç eklenmez,
 * pencere kaymaz). Otomatik çekim eşiğinden (`LIVE_MIN_SHARPNESS`) düşük tutuldu: kıpırdayan kare 1,1–1,4 ölçüldü; 1,6
 * oylamada da eşik olursa elde tutulan tablette kilit gecikirdi. Yalnız en bulanık kareleri eler.
 */
export const LIVE_VOTE_MIN_SHARPNESS = 1.2;

/** İki kare isteği arasında en az bu kadar (~saniyede 1); uçuşta hep TEK istek. */
export const LIVE_REQUEST_INTERVAL_MS = 1000;

/**
 * Otomatik çekim için en düşük netlik (`onStability.sharpness`, parlaklık birimi 0–255). `LiveTuning.kt` netliği yalnız
 * ÖLÇER (`SHARPNESS_STEP`), eşik tanımlamaz; eşik bu JS sabitidir. Native'e eşik eklenirse aynı değer olmalı (bekçi
 * `liveRhythm.test.ts`). Tablette ölçüldü (2026-11-08, çıkış çeki listesi, elde): sabit + net kare 1,75–2,45,
 * kıpırdayan kare 1,1–1,4 → 1,6. Eski 3 hiç geçilmiyordu (hepsi kilitli iken otomatik çekim gelmiyordu).
 */
export const LIVE_MIN_SHARPNESS = 1.6;

/** "Kıpırdatmayın" halkasının süresi: koşullar bu kadar kesintisiz sürerse fotoğraf çekilir. */
export const LIVE_HOLD_MS = 1500;
