// Play manifest temizliğinin TEK KAYNAĞI (K1 · K3): eklenti (plugins/withPlayManifestTemizligi) yazar,
// build-apk.mjs AAB'nin kendisinden ölçer, bekçi app.json'la kıyaslar. Bağımlılık taşımaz.

/** Uygulamanın kullanmadığı, Play beyanı doğuran ya da kurulum izni olan izinler (app.json blockedPermissions ⊇). */
const ENGELLI_IZINLER = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
];

/** expo-audio'nun ön plan hizmetleri: kilit ekranı oynatma ve kayıt kullanılmıyor (okutma bipi ön planda çalar). */
const KALDIRILAN_HIZMETLER = [
  'expo.modules.audio.service.AudioControlsService',
  'expo.modules.audio.service.AudioRecordingService',
];

/**
 * Protobuf/AXML manifest öğelerinden (`[{ ad, oznitelik }]`) Play sorunları: düz HTTP açık, engelli izin, kaldırılan
 * hizmet. Öznitelik adları ad alanı önekisizdir (`usesCleartextTraffic`, `name`).
 */
function playManifestSorunlari(ogeler) {
  const f = [];
  const uygulama = ogeler.find((o) => o.ad === 'application');
  const cleartext = uygulama?.oznitelik?.usesCleartextTraffic ?? null;
  if (cleartext !== 'false') f.push(`application usesCleartextTraffic=${cleartext ?? '(yok)'} — sürüm paketi yalnız şifreli bağlanır (K3; app.json iki yerde false)`);
  const izinler = new Set(ogeler.filter((o) => o.ad === 'uses-permission').map((o) => o.oznitelik?.name));
  for (const iz of ENGELLI_IZINLER) if (izinler.has(iz)) f.push(`${iz} izni var — app.json blockedPermissions (K1)`);
  const hizmetler = new Set(ogeler.filter((o) => o.ad === 'service').map((o) => o.oznitelik?.name));
  for (const h of KALDIRILAN_HIZMETLER) if (hizmetler.has(h)) f.push(`${h} hizmeti var — plugins/withPlayManifestTemizligi (K1)`);
  return f;
}

module.exports = { ENGELLI_IZINLER, KALDIRILAN_HIZMETLER, playManifestSorunlari };
