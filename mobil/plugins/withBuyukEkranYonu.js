// =============================================================================
// TeksERP Mobil — büyük ekranda yön kilidini koruyan eklenti (Android 16 / API 36)
// =============================================================================
// API 36'yı hedefleyen uygulamada Android 16+ büyük ekranda (sw ≥ 600dp) yön kilidini ve yeniden boyutlandırma
// kısıtını YOK SAYAR: tablette `useLandscapeLock` (expo-screen-orientation → setRequestedOrientation) etkisiz
// kalır. Play API 36'yı zorunlu kıldığından hedef düşürülemez; geçici çıkış uygulama düzeyindeki
// `PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY` özelliğidir. API 37'yi hedefleyen sürümde bu özellik yok sayılır
// (borç: yatay/dikey ekranların kilitsiz düzene geçmesi). Telefon (sw < 600dp) bu değişiklikten etkilenmez.
// İdempotent: aynı adlı özellik varsa değeri güncellenir, ikinci kopya eklenmez.
// =============================================================================

const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const { YON_OZELLIGI } = require('../scripts/lib/buyuk-ekran.cjs');

/** AndroidManifest nesnesinin <application> öğesine özelliği yazar (saf). */
function yonOzelligiYaz(manifest) {
  const uygulama = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const ozellikler = Array.isArray(uygulama.property) ? uygulama.property : [];
  const mevcut = ozellikler.find((p) => p?.$?.['android:name'] === YON_OZELLIGI);
  if (mevcut) mevcut.$['android:value'] = 'true';
  else ozellikler.push({ $: { 'android:name': YON_OZELLIGI, 'android:value': 'true' } });
  uygulama.property = ozellikler;
  return manifest;
}

module.exports = function withBuyukEkranYonu(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = yonOzelligiYaz(cfg.modResults);
    return cfg;
  });
};
module.exports.YON_OZELLIGI = YON_OZELLIGI;
module.exports.yonOzelligiYaz = yonOzelligiYaz;
