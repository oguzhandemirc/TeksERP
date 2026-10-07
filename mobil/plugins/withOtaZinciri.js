// =============================================================================
// TeksERP Mobil — OTA sertifika ZİNCİRİ meta-data'sını prebuild'e yazan eklenti (K-2 / I5)
// =============================================================================
// APK'ya gömülen `updates.codeSigningCertificate` OTA KÖKÜDÜR; manifesti yıllık OTA yaprağı imzalar ve yaprak
// yanıtın `certificate_chain` parçasında gelir. expo-updates bunu yalnız
// `expo.modules.updates.CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN = true` iken okur ve
// `@expo/config-plugins` 54 bu meta-data'yı YAZMAZ (docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §1.4).
// Meta-data yoksa tablet zincir parçasını yok sayar, kökle doğrulamaya çalışır ve HER OTA'yı reddeder.
//
// ⚠️ FAIL-CLOSED: sertifika yolu yoksa ya da gömülecek dosya OTA kökü değilse (CA değil, EKU taşıyor — ör. eski
// öz-imzalı yaprak) prebuild DURUR: o APK sahada zinciri hiç doğrulayamazdı. Dosya yoksa Expo'nun kendi eklentisi
// de durur. İdempotent: `addMetaDataItemToMainApplication` var olan öğeyi günceller.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');
const { ZINCIR_META, kokHatalari } = require('../scripts/lib/ota-zinciri.cjs');

/** Gömülecek kök dosyasını denetler (saf; bekçi doğrudan çağırır). Hata metni döner, sorun yoksa null. */
function kokSorunu(projeKoku, sertifikaYolu) {
  if (!sertifikaYolu) return 'updates.codeSigningCertificate tanımlı değil — zincirsiz/imzasız APK üretilmez';
  const tam = path.join(projeKoku, sertifikaYolu);
  let pem;
  try {
    pem = fs.readFileSync(tam, 'utf8');
  } catch {
    return `OTA kökü sertifikası yok: ${tam} (anahtar töreni: npm run build:apk -- --check komutu yolu basar)`;
  }
  const h = kokHatalari(pem);
  return h.length ? `gömülecek sertifika OTA KÖKÜ DEĞİL (${tam}):\n  • ${h.join('\n  • ')}` : null;
}

/** AndroidManifest nesnesine zincir meta-data'sını yazar (saf). */
function zincirMetaYaz(manifest) {
  const uygulama = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(uygulama, ZINCIR_META, 'true');
  return manifest;
}

module.exports = function withOtaZinciri(config) {
  return withAndroidManifest(config, (cfg) => {
    const sorun = kokSorunu(cfg.modRequest.projectRoot, cfg.updates?.codeSigningCertificate);
    if (sorun) throw new Error(`withOtaZinciri: ${sorun}`);
    cfg.modResults = zincirMetaYaz(cfg.modResults);
    return cfg;
  });
};
module.exports.kokSorunu = kokSorunu;
module.exports.zincirMetaYaz = zincirMetaYaz;
