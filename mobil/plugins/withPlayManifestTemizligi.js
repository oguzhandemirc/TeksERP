// =============================================================================
// TeksERP Mobil — Play manifest temizliği (K1)
// =============================================================================
// expo-audio kütüphane manifesti iki ön plan hizmeti beyan eder (mediaPlayback · microphone). Uygulama ikisini de
// başlatmaz; beyan kalırsa Play "Ön plan hizmetleri" formu + video ister. İzni engellemek hizmet beyanını
// bırakır ⇒ hizmetler birleştirmede `tools:node="remove"` ile çıkarılır. İdempotent.
// =============================================================================

const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const { KALDIRILAN_HIZMETLER } = require('../scripts/lib/play-manifest.cjs');

/** AndroidManifest nesnesine hizmetleri kaldıran birleştirme yönergelerini yazar (saf). */
function hizmetKaldirmaYaz(manifest) {
  manifest.manifest.$ = manifest.manifest.$ ?? {};
  manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const uygulama = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const hizmetler = Array.isArray(uygulama.service) ? uygulama.service : [];
  for (const ad of KALDIRILAN_HIZMETLER) {
    const mevcut = hizmetler.find((s) => s?.$?.['android:name'] === ad);
    if (mevcut) mevcut.$ = { 'android:name': ad, 'tools:node': 'remove' };
    else hizmetler.push({ $: { 'android:name': ad, 'tools:node': 'remove' } });
  }
  uygulama.service = hizmetler;
  return manifest;
}

module.exports = function withPlayManifestTemizligi(config) {
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = hizmetKaldirmaYaz(cfg.modResults);
    return cfg;
  });
};
module.exports.hizmetKaldirmaYaz = hizmetKaldirmaYaz;
