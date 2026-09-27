// =============================================================================
// TeksERP Mobil — TABLET DERLEMESİNİN KANAL KİMLİĞİ (deploy/kanallar.json)
// =============================================================================
// Kanal kimliği (paket adı · görünen ad · güncelleme adresi · OTA sertifikası ·
// görünür etiket) DERLEME ANINDA enjekte edilir: derleme betikleri `TEKSERP_KANAL`
// ortam değişkenini koyar, `app.config.js` onu görünce kimliği kayıt defterinden
// uygular. `app.json` DİNLENME (varsayilan kanal) kimliğini taşır ve bir kanal
// için YAZILMAZ — native parmak izinin girdisidir (kanal değişimi sahte "NATIVE
// DEĞİŞTİ" üretirdi).
//
// ⚠️ CommonJS BİLİNÇLİ: `app.config.js` Expo tarafından `require` edilir (feed.cjs
// gerekçesi). Kayıt defterinin TAM doğrulaması `scripts/lib/kanallar.mjs`
// `kanalCoz`dadır; derleme betikleri onu ÖNCE çağırır. Burada yalnız okuma +
// kapalı küme (bilinmeyen kod = hata) + kimliğin uygulanması/ölçülmesi yaşar.
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');

const { manifestUrl, normalizeFeed } = require('./feed.cjs');

/** Derleme betiklerinin çocuk süreçlere (prebuild · gradle · export · config) geçirdiği ad. */
const KANAL_ORTAM = 'TEKSERP_KANAL';
const KAYIT_YOLU = path.join(__dirname, '..', '..', '..', 'deploy', 'kanallar.json');

/** Kayıt defterinden bir kanal — okunamazsa ya da kod kayıtlı değilse HATA (fail-closed). */
function kanalKaydiOku(kod, kayitYolu = KAYIT_YOLU) {
  let kayit;
  try {
    kayit = JSON.parse(fs.readFileSync(kayitYolu, 'utf8'));
  } catch (e) {
    throw new Error(`${KANAL_ORTAM}="${kod}" ama kanal kayıt defteri okunamadı (${kayitYolu}): ${e.message}`);
  }
  const kanallar = kayit && typeof kayit.kanallar === 'object' && kayit.kanallar ? kayit.kanallar : {};
  if (!Object.prototype.hasOwnProperty.call(kanallar, kod)) {
    throw new Error(
      `BİLİNMEYEN KANAL ${KANAL_ORTAM}="${kod}" — kayıtlı kanallar: ${Object.keys(kanallar).join(', ') || '(yok)'}`,
    );
  }
  return kanallar[kod];
}

/** Kanalın OTA imza materyali (mobil/ köküne göre). Anahtar yolu sertifika yolunun AYNASIDIR. */
function otaImzaYollari(kanal) {
  const sertifika = String(kanal?.tablet?.otaSertifika ?? '');
  const m = /^keystore\/ota-certs(-[a-z0-9-]+)?\/certificate\.pem$/.exec(sertifika);
  if (!m) {
    throw new Error(
      `tablet.otaSertifika "${sertifika}" beklenen biçimde değil (keystore/ota-certs[-<kanal>]/certificate.pem) — anahtar yolu türetilemez`,
    );
  }
  return { sertifika, anahtar: `keystore/ota-keys${m[1] ?? ''}/private-key.pem` };
}

/**
 * Expo yapılandırmasına kanalın kimliğini uygular (saf fonksiyon).
 * Anahtar SIRASI korunur (mevcut alanlar yerinde ezilir, `url` sona eklenir) — varsayılan
 * kanal için çıktı dinlenmedeki çıktıyla birebir.
 */
function kanalYapilandirmasi(config, kod, runtimeVersion, kanal = kanalKaydiOku(kod)) {
  const feed = normalizeFeed(kanal.yayin.mobilFeed);
  const ezme = process.env.EXPO_PUBLIC_UPDATE_URL;
  if (ezme && ezme.trim() && normalizeFeed(ezme) !== feed) {
    throw new Error(
      `EXPO_PUBLIC_UPDATE_URL (${ezme}) "${kod}" kanalının güncelleme kökü (${feed}) değil — kanal derlemesinde adres kayıt defterinden gelir`,
    );
  }
  const t = kanal.tablet;
  const sonuc = {
    ...config,
    name: t.gorunenAd,
    android: { ...(config.android ?? {}), package: t.androidPaket },
    // iOS derlemesi yok; kimlik çifti ayrışmasın diye Android paket adının aynası.
    ios: { ...(config.ios ?? {}), bundleIdentifier: t.androidPaket },
    updates: {
      ...(config.updates ?? {}),
      codeSigningCertificate: `./${t.otaSertifika}`,
      url: manifestUrl(feed, runtimeVersion),
    },
  };
  // Görünür etiket GÖSTERİMDİR, davranış değil; üretim kanalında null → alan hiç doğmaz.
  if (kanal.gorunurEtiket) sonuc.extra = { ...(config.extra ?? {}), gorunurEtiket: kanal.gorunurEtiket };
  return sonuc;
}

/**
 * Değerlendirilmiş bir Expo yapılandırması (app.config.js çıktısı · `expo config` ·
 * APK'daki `assets/app.config` · OTA manifestinin `extra.expoClient`i) bu kanalın mı?
 * Boş dizi = evet. `herkese: true` → `--type public` çıktısı (imza alanlarını taşımaz).
 */
function tabletYapilandirmaFarki(kanal, cfg, runtimeVersion, { herkese = false } = {}) {
  const f = [];
  const fark = (neresi, gercek, beklenen) => {
    if (gercek !== beklenen) f.push(`${neresi} = "${gercek ?? '(yok)'}" — kanal "${beklenen ?? '(yok)'}" bekliyor`);
  };
  const t = kanal.tablet;
  fark('name', cfg?.name, t.gorunenAd);
  fark('android.package', cfg?.android?.package, t.androidPaket);
  fark('updates.url', cfg?.updates?.url, manifestUrl(kanal.yayin.mobilFeed, runtimeVersion));
  if (!herkese) {
    fark('updates.codeSigningCertificate',
      String(cfg?.updates?.codeSigningCertificate ?? '').replace(/^\.\//, '') || undefined, t.otaSertifika);
  }
  fark('extra.gorunurEtiket', cfg?.extra?.gorunurEtiket ?? null, kanal.gorunurEtiket ?? null);
  return f;
}

module.exports = {
  KANAL_ORTAM,
  KAYIT_YOLU,
  kanalKaydiOku,
  kanalYapilandirmasi,
  otaImzaYollari,
  tabletYapilandirmaFarki,
};
