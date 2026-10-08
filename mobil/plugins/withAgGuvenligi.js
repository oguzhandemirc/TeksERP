// =============================================================================
// TeksERP Mobil — ağ güvenlik yapılandırması (TABLET-GENEL-CA-BAGLANTI §3)
// =============================================================================
// Sürüm derlemesi: şifresiz kapalı, güven çapası yalnız sistem deposu (kullanıcı/MDM CA'sı beyanlı hariç). Yapılandırma
// eklenince manifestteki usesCleartextTraffic yok sayılır ⇒ geliştirme derlemesi Metro için src/debug altında kendi
// kopyasını taşır. İçerik tek kaynaktan (scripts/lib/play-manifest.cjs); build-apk AAB'den ölçer. İdempotent.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const { NSC_ADI, NSC_SURUM, NSC_GELISTIRME } = require('../scripts/lib/play-manifest.cjs');

function manifesteYaz(manifest) {
  const uygulama = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  uygulama.$['android:networkSecurityConfig'] = `@xml/${NSC_ADI}`;
  return manifest;
}

function dosyalariYaz(androidKoku) {
  for (const [kaynak, icerik] of [['main', NSC_SURUM], ['debug', NSC_GELISTIRME]]) {
    const dizin = path.join(androidKoku, 'app', 'src', kaynak, 'res', 'xml');
    fs.mkdirSync(dizin, { recursive: true });
    fs.writeFileSync(path.join(dizin, `${NSC_ADI}.xml`), icerik);
  }
}

module.exports = function withAgGuvenligi(config) {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = manifesteYaz(cfg.modResults);
    return cfg;
  });
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      dosyalariYaz(cfg.modRequest.platformProjectRoot);
      return cfg;
    },
  ]);
};
module.exports.manifesteYaz = manifesteYaz;
module.exports.dosyalariYaz = dosyalariYaz;
