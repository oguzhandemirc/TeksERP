// =============================================================================
// TeksERP Mobil — release İMZA ANAHTARLARI (TEK KAYNAK: gradle eklentisi + build-apk)
// =============================================================================
// Ortak tablet iki ayrı anahtarla imzalanır ve ikisi de eski kanalın (adnansahin) mührü DEĞİLDİR (K-14):
//   · deneme       — yerel deneme APK'sı (`npm run build:apk`: emülatör, prova); sahaya/fabrikaya DAĞITILMAZ.
//   · play-yukleme — Google Play yükleme anahtarı (`npm run build:aab`); uygulama mührünü Google tutar.
// Görev → anahtar eşlemesi gradle'da da buradan türer (plugins/withReleaseKeystore.js); AAB hiçbir koşulda
// deneme anahtarına ya da `keystore/` kökündeki eski mühre düşmez. Anahtarlar git DIŞI, burada ÜRETİLMEZ.
// Play yükleme parolası `keystore.properties`te DURMAZ: macOS Anahtar Zinciri `tekserp/play-yukleme`den okunur
// (scripts/lib/parola-kasasi.mjs) ve yalnız Gradle/keytool alt sürecine ortamla verilir (`IMZA_PAROLA_ORTAMI`).
// =============================================================================

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const IMZA_ANAHTARLARI = Object.freeze({
  deneme: Object.freeze({
    dizin: 'keystore/deneme',
    ad: "TEST imza anahtarı (yerel deneme APK'sı — sahaya dağıtılmaz)",
    storeFile: 'tekserp-deneme.keystore',
    alias: 'tekserp-deneme',
    cn: 'TeksERP Deneme',
    kasa: null,
  }),
  'play-yukleme': Object.freeze({
    dizin: 'keystore/play-yukleme',
    ad: 'Google Play YÜKLEME anahtarı (AAB)',
    storeFile: 'tekserp-play-yukleme.keystore',
    alias: 'tekserp-yukleme',
    cn: 'TeksERP Play Yukleme',
    kasa: 'play-yukleme',
  }),
});

/** Kasadan okunan parolanın YALNIZ Gradle/keytool alt sürecine verildiği ortam anahtarı (diske ve argv'ye yazılmaz). */
const IMZA_PAROLA_ORTAMI = 'TEKSERP_IMZA_PAROLASI';
const PAROLA_ALANLARI = ['storePassword', 'keyPassword'];

/** Gradle görevinden anahtar türü: bundle*Release → play-yukleme, diğer release görevleri → deneme. */
function gorevAnahtarTuru(gorevAdi) {
  return /^bundle/.test(gorevAdi) ? 'play-yukleme' : 'deneme';
}

function tanim(tur) {
  const t = IMZA_ANAHTARLARI[tur];
  if (!t) throw new Error(`bilinmeyen imza anahtarı türü: ${tur}`);
  return t;
}

/** Anahtarı üreten komut — yalnız METİN; kullanıcı anahtar töreninde Mac'te koşar (burada koşulmaz). */
function anahtarUretimKomutu(tur) {
  const t = tanim(tur);
  const uret = [
    `cd mobil && mkdir -p ${t.dizin} && chmod 700 ${t.dizin}`,
    `keytool -genkeypair -v -storetype PKCS12 -keystore ${t.dizin}/${t.storeFile} -alias ${t.alias} ` +
      `-keyalg RSA -keysize 4096 -validity 10000 -dname "CN=${t.cn}, O=Etkili Yazilim, C=TR"`,
  ];
  if (t.kasa) {
    return [
      ...uret,
      `Parolayı Anahtar Zinciri'ne kaydet (repo kökünde, kendi Terminal'inde): node scripts/parola-kaydet.mjs ${t.kasa}`,
      `${t.dizin}/keystore.properties dosyasını yaz (chmod 600; PAROLA YAZILMAZ):`,
      `  storeFile=${t.storeFile}`,
      `  keyAlias=${t.alias}`,
    ];
  }
  return [
    ...uret,
    `${t.dizin}/keystore.properties dosyasını yaz (chmod 600; PKCS12'de iki parola aynıdır):`,
    `  storeFile=${t.storeFile}`,
    '  storePassword=<parola>',
    `  keyAlias=${t.alias}`,
    '  keyPassword=<parola>',
  ];
}

function propsOku(yol) {
  return Object.fromEntries(
    fs.readFileSync(yol, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const ozet = (yol) => crypto.createHash('sha256').update(fs.readFileSync(yol)).digest('hex');

/**
 * Anahtar hazır mı ve yalnız KENDİ dizininde mi? Diğer türün anahtarının ya da `keystore/` kökündeki eski
 * mührün bayt-kopyası İHLALDİR (AAB test anahtarına, test APK'sı eski mühre düşmez).
 * @returns {{sonuc: 'hazir'|'yok'|'ihlal', satirlar: string[], props?: object, storeYolu?: string, propsYolu: string}}
 */
function imzaAnahtariDenetimi(mobilKok, tur) {
  const t = tanim(tur);
  const propsYolu = path.join(mobilKok, t.dizin, 'keystore.properties');
  if (!fs.existsSync(propsYolu)) {
    return { sonuc: 'yok', propsYolu, satirlar: [`${t.ad} YOK`, `Beklenen: ${propsYolu}`] };
  }
  let props;
  try {
    props = propsOku(propsYolu);
  } catch (e) {
    return { sonuc: 'ihlal', propsYolu, satirlar: [`${propsYolu} okunamadı: ${e.message}`] };
  }
  const sf = String(props.storeFile ?? '');
  const duzParola = t.kasa ? PAROLA_ALANLARI.filter((a) => a in props) : [];
  if (duzParola.length) {
    return {
      sonuc: 'ihlal',
      propsYolu,
      satirlar: [
        `${propsYolu} DÜZ PAROLA taşıyor (${duzParola.join(', ')}) — parola dosyada durmaz, Anahtar Zinciri'nden okunur`,
        `Önce kaydet: node scripts/parola-kaydet.mjs ${t.kasa}  ·  sonra bu satırları dosyadan sil (değer basılmadı)`,
      ],
    };
  }
  const eksik = ['storeFile', ...(t.kasa ? [] : ['storePassword']), 'keyAlias', ...(t.kasa ? [] : ['keyPassword'])].filter((a) => !props[a]);
  if (eksik.length) return { sonuc: 'ihlal', propsYolu, satirlar: [`${propsYolu} eksik alan: ${eksik.join(', ')}`] };
  if (/[\\/]/.test(sf) || sf.includes('..')) {
    return { sonuc: 'ihlal', propsYolu, satirlar: [`storeFile "${sf}" kendi dizininde değil — anahtar ${t.dizin}/ içinde durur, başka yere işaret edemez`] };
  }
  const storeYolu = path.join(mobilKok, t.dizin, sf);
  if (!fs.existsSync(storeYolu)) return { sonuc: 'yok', propsYolu, satirlar: [`${t.ad}: anahtar deposu yok`, `Beklenen: ${storeYolu}`] };
  const bu = ozet(storeYolu);
  const ihlal = [];
  for (const [digerTur, d] of Object.entries(IMZA_ANAHTARLARI)) {
    if (digerTur === tur) continue;
    const dp = path.join(mobilKok, d.dizin, 'keystore.properties');
    try {
      const ds = path.join(mobilKok, d.dizin, propsOku(dp).storeFile ?? '');
      if (fs.statSync(ds).isFile() && ozet(ds) === bu) ihlal.push(`${t.dizin} anahtarı ${d.dizin} anahtarının KOPYASI`);
    } catch {
      // diğer anahtar yok: kıyas yok
    }
  }
  const kok = path.join(mobilKok, 'keystore');
  try {
    for (const ad of fs.readdirSync(kok)) {
      const y = path.join(kok, ad);
      if (/\.(keystore|jks|p12)$/i.test(ad) && fs.statSync(y).isFile() && ozet(y) === bu) {
        ihlal.push(`${t.dizin} anahtarı keystore/ kökündeki ${ad} (eski kanal mührü) ile AYNI`);
      }
    }
  } catch {
    // kök okunamadı: kıyas yok
  }
  if (ihlal.length) return { sonuc: 'ihlal', propsYolu, satirlar: ihlal };
  return { sonuc: 'hazir', propsYolu, props, storeYolu, satirlar: [`${t.ad}: ${storeYolu}`] };
}

module.exports = { IMZA_ANAHTARLARI, IMZA_PAROLA_ORTAMI, gorevAnahtarTuru, anahtarUretimKomutu, imzaAnahtariDenetimi };
