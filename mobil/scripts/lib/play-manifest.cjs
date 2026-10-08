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

/** Ağ güvenlik yapılandırmasının kaynak adı (res/xml/<ad>.xml; manifest `@xml/<ad>`). */
const NSC_ADI = 'network_security_config';

/**
 * Sürüm derlemesinin ağ güvenlik yapılandırması (TABLET-GENEL-CA-BAGLANTI §3): şifresiz kapalı, güven çapası YALNIZ
 * sistem deposu — kullanıcının/MDM'in eklediği CA'lar beyanlı olarak hariç. Sabitli kip native katmanda ayrıca çalışır.
 */
const NSC_SURUM = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
</network-security-config>
`;

/** Geliştirme (debug) derlemesi: Metro'ya şifresiz bağlanır; güven yine yalnız sistem. src/debug kaynağı sürümü ezmez. */
const NSC_GELISTIRME = NSC_SURUM.replace('cleartextTrafficPermitted="false"', 'cleartextTrafficPermitted="true"');

/**
 * AAB'nin ağ güvenlik yapılandırması sorunları: manifest yapılandırmayı göstermeli; yapılandırma şifresizi kapatmalı,
 * yalnız sistem çapasına güvenmeli, alan adına özel istisna (domain-config) taşımamalı. `nsc` proto XML öğeleri.
 */
function agGuvenligiSorunlari(ogeler, nsc) {
  const f = [];
  const uygulama = ogeler.find((o) => o.ad === 'application');
  if (!uygulama || !('networkSecurityConfig' in (uygulama.oznitelik ?? {}))) {
    f.push('application networkSecurityConfig yok — kullanıcı CA dışlaması beyanlı değil (plugins/withAgGuvenligi)');
  }
  if (!nsc) return [...f, `res/xml/${NSC_ADI}.xml yok — ağ güvenlik yapılandırması ÖLÇÜLEMEDİ`];
  const taban = nsc.find((o) => o.ad === 'base-config');
  if (taban?.oznitelik?.cleartextTrafficPermitted !== 'false') {
    f.push(`ağ güvenlik yapılandırması base-config cleartextTrafficPermitted=${taban?.oznitelik?.cleartextTrafficPermitted ?? '(yok)'} — şifresiz kapalı olmalı`);
  }
  const capalar = nsc.filter((o) => o.ad === 'certificates').map((o) => o.oznitelik?.src ?? '(yok)');
  if (capalar.length === 0 || capalar.some((c) => c !== 'system')) {
    f.push(`ağ güvenlik yapılandırması güven çapası [${capalar.join(', ')}] — yalnız "system" olmalı (kullanıcı CA'sı hariç)`);
  }
  if (nsc.some((o) => o.ad === 'domain-config' || o.ad === 'debug-overrides' || o.ad === 'pin-set')) {
    f.push('ağ güvenlik yapılandırması domain-config/debug-overrides/pin-set taşıyor — sürüm paketinde istisna yok');
  }
  return f;
}

module.exports = { ENGELLI_IZINLER, KALDIRILAN_HIZMETLER, NSC_ADI, NSC_SURUM, NSC_GELISTIRME, agGuvenligiSorunlari, playManifestSorunlari };
