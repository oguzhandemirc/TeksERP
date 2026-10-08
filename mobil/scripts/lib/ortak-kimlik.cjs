// =============================================================================
// TeksERP Mobil — TEK ORTAK PAKETİN tablet kimliği (deploy/dagitim.json)
// =============================================================================
// Argümansız derleme (build-apk, `expo prebuild`) bu kimlikle doğar: paket adı · görünen ad ·
// runtimeVersion · OTA sertifikası · grup-nötr güncelleme adresi (Worker takma adı). Değerler
// YALNIZ kayıttadır (KARAR K-1/K-2 tek yerden değişir); app.json'daki kimlik alanları bu kaydın
// taban aynasıdır (eski kanal değerleri `eski-kanal-son` etiketinde) ve derlemede bu modülce yine uygulanır.
//
// ⚠️ CommonJS BİLİNÇLİ: `app.config.js` Expo tarafından `require` edilir. Kaydın TAM doğrulaması
// `scripts/lib/dagitim.mjs` `kayitHatalari`ndadır (build-apk önce onu çağırır); burada okuma +
// tablet bloğunun biçimi + türetim yaşar. Türetimin dagitim.mjs `turet`iyle eşitliğini
// `scripts/test_tablet_ortak_paket.mjs` ölçer.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');

const { OTA_YAPRAK_GUN, OTA_KOK_GUN } = require('./ota-zinciri.cjs');

const KAYIT_YOLU = path.join(__dirname, '..', '..', '..', 'deploy', 'dagitim.json');
/** Worker'ın grup-nötr OTA yolu `<indirmeKoku>ota/<rv>/manifest` (dagitim.mjs AYRILMIS_GRUP_KODLARI[0]). */
const TAKMA_AD = 'ota';
/** Zincir meta-data'sını yazan eklenti (K-2): ortak yapılandırmada olmazsa APK zinciri okumaz, her OTA RED. */
const ZINCIR_EKLENTISI = './plugins/withOtaZinciri';
/**
 * Ortak OTA KÖKÜ sertifikasının biçimi (APK'ya gömülür; K-2/I5); imza anahtarı kimliği (kid) bu addan türer.
 * Yaprak depoda DEĞİLDİR: yıllık dönem töreninin istemci dizinindedir ve yayına `--ota-anahtar` ile verilir.
 */
const SERTIFIKA_DESENI = /^keystore\/ota-certs-([a-z0-9][a-z0-9-]{0,31})\/certificate\.pem$/;

function ortakKaydiOku(kayitYolu = KAYIT_YOLU) {
  try {
    return JSON.parse(fs.readFileSync(kayitYolu, 'utf8'));
  } catch (e) {
    throw new Error(`Ortak paket kaydı okunamadı (${kayitYolu}): ${e.message}`);
  }
}

/**
 * Kayıttan tablet kimliği. Eksik/biçimsiz alan → HATA (fail-closed; yerleşik değere sapma yok).
 * `anahtarKimligi` OTA imza başlığının `keyid`idir: sertifika dizini değişince (anahtar dönüşü) o da değişir.
 */
function ortakKimlik(kayit = ortakKaydiOku()) {
  const t = kayit?.urun?.tablet ?? {};
  const kok = String(kayit?.indirmeKoku ?? '');
  const eksik = ['androidPaket', 'gorunenAd', 'runtimeVersion', 'otaSertifika'].filter(
    (a) => typeof t[a] !== 'string' || !t[a].trim(),
  );
  if (eksik.length) throw new Error(`Ortak paket kaydında urun.tablet eksik: ${eksik.join(', ')}`);
  if (!/^https:\/\/[a-z0-9.-]+\/$/.test(kok)) {
    throw new Error(`Ortak paket kaydında indirmeKoku biçimsiz ("${kok}") — "https://<ana makine>/" beklenir`);
  }
  if (!/^[0-9]+\.[0-9]+$/.test(t.runtimeVersion)) {
    throw new Error(`Ortak paket kaydında runtimeVersion biçimsiz ("${t.runtimeVersion}")`);
  }
  const m = SERTIFIKA_DESENI.exec(t.otaSertifika);
  if (!m) {
    throw new Error(
      `Ortak paket kaydında otaSertifika "${t.otaSertifika}" beklenen biçimde değil ` +
        '(keystore/ota-certs-<ad>/certificate.pem) — anahtar yolu ve kid türetilemez',
    );
  }
  return {
    androidPaket: t.androidPaket,
    gorunenAd: t.gorunenAd,
    runtimeVersion: t.runtimeVersion,
    otaSertifika: t.otaSertifika,
    anahtarKimligi: m[1],
    indirmeKoku: kok,
    guncellemeUrl: `${kok}${TAKMA_AD}/${t.runtimeVersion}/manifest`,
  };
}

/** Satıcı üretim dizini (tören aracının varsayılanı); OTA kökü `anahtarlar/`, yıllık yaprak `donemler/<damga>/istemci/`. */
const URETIM_DIZINI = '$HOME/.tekserp/satici-uretim';

/**
 * OTA zinciri yönergesinin tek yazımı (build-apk/yayın mesajı, belge ve bekçi aynı metni kullanır). Kök ve yaprak
 * tören araçlarıyla üretilir, elle openssl yok; kök anahtarı ve yaprak mobil/ DIŞINDADIR (URETIM-SATICI-TOREN.md §9).
 */
function otaTorenYonergesi(k = ortakKimlik()) {
  const kok = `${URETIM_DIZINI}/anahtarlar/ota-kok.pem`;
  const yaprak = `${URETIM_DIZINI}/donemler/<damga>/istemci/ota-yaprak`;
  return [
    `# OTA kökü (CA, ${OTA_KOK_GUN} gün, APK'ya gömülür) — yalnız İLK kez, satıcı kök parolasıyla:`,
    `node mobil/scripts/ota-zinciri.mjs kok-uret --dizin=${URETIM_DIZINI}/anahtarlar`,
    '# APK\'ya gömülen kopya:',
    `mkdir -p mobil/${path.posix.dirname(k.otaSertifika)} && cp ${kok} mobil/${k.otaSertifika}`,
    `# OTA yaprağı (${OTA_YAPRAK_GUN} gün, manifesti imzalar) — yıllık dönem töreninde (docs/ops/URETIM-SATICI-TOREN.md §9):`,
    'node deploy/satici/uretim-toren.mjs donem --istemci',
    `# Yayın: node deploy/mobil-grup-yayinla.mjs … --ota-anahtar=${yaprak}/private-key.pem`,
    `# Ölçüm: cd mobil && node scripts/ota-zinciri.mjs denetle --yaprak=${yaprak}/certificate.pem`,
  ];
}

/**
 * Expo yapılandırmasına ortak kimliği uygular (saf fonksiyon; anahtar sırası korunur).
 * Güncelleme adresi ezilemez: EXPO_PUBLIC_UPDATE_URL verilmişse HATA (adres kayıttan türer).
 */
function ortakYapilandirmasi(config, k = ortakKimlik()) {
  const ezme = process.env.EXPO_PUBLIC_UPDATE_URL;
  if (ezme && ezme.trim()) {
    throw new Error(
      `EXPO_PUBLIC_UPDATE_URL (${ezme}) ortak pakette kullanılamaz — güncelleme adresi ` +
        `deploy/dagitim.json'dan türer (${k.guncellemeUrl})`,
    );
  }
  const { gorunurEtiket: _etiket, ...extraKalan } = config.extra ?? {};
  const sonuc = {
    ...config,
    name: k.gorunenAd,
    android: { ...(config.android ?? {}), package: k.androidPaket },
    // iOS derlemesi yok; kimlik çifti ayrışmasın diye Android paket adının aynası.
    ios: { ...(config.ios ?? {}), bundleIdentifier: k.androidPaket },
    runtimeVersion: k.runtimeVersion,
    updates: {
      ...(config.updates ?? {}),
      codeSigningCertificate: `./${k.otaSertifika}`,
      codeSigningMetadata: { ...(config.updates?.codeSigningMetadata ?? {}), keyid: k.anahtarKimligi },
      url: k.guncellemeUrl,
    },
  };
  // Görünür etiket (TEST/DEMO) ortak pakette derlemeden gelmez — lisans sınıfından (O8).
  if (config.extra) {
    if (Object.keys(extraKalan).length) sonuc.extra = extraKalan;
    else delete sonuc.extra;
  }
  return sonuc;
}

/**
 * Değerlendirilmiş yapılandırma (app.config.js çıktısı · APK'daki `assets/app.config`) ortak paketin mi?
 * Boş dizi = evet. `herkese: true` → çalışma anı (public) yapılandırması: imza alanlarını taşımaz,
 * runtimeVersion'ı adres bağlar.
 */
function ortakYapilandirmaFarki(cfg, { herkese = false } = {}, k = ortakKimlik()) {
  const f = [];
  const fark = (neresi, gercek, beklenen) => {
    if (gercek !== beklenen) f.push(`${neresi} = "${gercek ?? '(yok)'}" — ortak paket "${beklenen ?? '(yok)'}" bekliyor`);
  };
  fark('name', cfg?.name, k.gorunenAd);
  fark('android.package', cfg?.android?.package, k.androidPaket);
  fark('updates.url', cfg?.updates?.url, k.guncellemeUrl);
  if (!herkese) {
    fark('runtimeVersion', cfg?.runtimeVersion, k.runtimeVersion);
    fark('updates.codeSigningCertificate',
      String(cfg?.updates?.codeSigningCertificate ?? '').replace(/^\.\//, '') || undefined, k.otaSertifika);
    fark('updates.codeSigningMetadata.keyid', cfg?.updates?.codeSigningMetadata?.keyid, k.anahtarKimligi);
    fark('updates.enabled', cfg?.updates?.enabled, true);
    const eklentiler = (cfg?.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    if (!eklentiler.includes(ZINCIR_EKLENTISI)) {
      f.push(`plugins ${ZINCIR_EKLENTISI} taşımıyor — APK OTA sertifika zincirini okumaz, ortak paket her manifesti reddeder`);
    }
  }
  fark('extra.gorunurEtiket', cfg?.extra?.gorunurEtiket ?? null, null);
  return f;
}

module.exports = {
  KAYIT_YOLU,
  TAKMA_AD,
  ZINCIR_EKLENTISI,
  ortakKaydiOku,
  ortakKimlik,
  otaTorenYonergesi,
  ortakYapilandirmasi,
  ortakYapilandirmaFarki,
};
