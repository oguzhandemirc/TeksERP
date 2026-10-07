// =============================================================================
// TeksERP Mobil — OTA SERTİFİKA ZİNCİRİ (K-2 / I5) · TEK KAYNAK · zero-dep (node:crypto + openssl CLI)
// =============================================================================
// Ortak tablet APK'ya yalnız OTA KÖKÜNÜ gömer (öz-imzalı RSA CA, pathLen 0, keyCertSign, EKU YOK); manifesti
// yıllık OTA YAPRAĞI (≤395 gün, digitalSignature + EKU codeSigning, CA DEĞİL) imzalar ve yaprak manifest
// yanıtının `certificate_chain` parçasında gelir (docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §1.4, §3.1, §3.5).
//
// Buradaki istemci aynası expo-updates 29 `codesigning/CertificateChain.kt`in kurallarını izler (ondan GEVŞEK
// olamaz, daha katı olabilir): her halkada cihaz saatiyle geçerlilik, halkalar özne/veren + imza ile bağlı, son halka
// öz-imzalı; zincirde kök CA + keyCertSign; yaprak digitalSignature + EKU codeSigning. Kök tek başına (zincir
// parçası yoksa) yaprak sayılır ve EKU'suz olduğu için RED — kök kendisi imzacı olamaz.
//
// ⚠️ CommonJS BİLİNÇLİ: config eklentisi (`plugins/withOtaZinciri.js`) ve jest `require` eder; .mjs'ler createRequire ile.
// =============================================================================

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GUN = 86_400_000;
/** Android meta-data adı (UpdatesConfiguration.kt:121); Expo yapılandırma eklentisi bunu YAZMAZ (§1.4). */
const ZINCIR_META = 'expo.modules.updates.CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN';
/** Manifest yanıtındaki parçanın adı (FileDownloader.kt:188). */
const ZINCIR_PARCASI = 'certificate_chain';
const CODE_SIGNING_OID = '1.3.6.1.5.5.7.3.3';
const EXPO_PROJE_OID = '1.2.840.113556.1.8000.2554.43437.254.128.102.157.7894389.20439.2.1';
const OTA_KOK_GUN = 10_950; // 30 yıl
const OTA_YAPRAK_GUN = 395;
/** Yayın aracı bitişine bundan az gün kalan yaprakla İMZALAMAZ (§3.5; yıllık tören yeniden imzalar). */
const OTA_YAPRAK_ESIK_GUN = 30;
const KOK_RSA_ASGARI = 3072;
const YAPRAK_RSA_ASGARI = 2048;

/**
 * openssl uzantı profilleri — törenin ve deneme zincirinin TEK tanımı (bekçi bu profillerle üretip doğrular).
 * `ota_kok`: CA, pathLen 0, yalnız keyCertSign/cRLSign, EKU YOK. `ota_yaprak`: CA değil, digitalSignature, EKU codeSigning.
 */
const OPENSSL_PROFILI = `[ req ]
distinguished_name = ota_dn
prompt = no
[ ota_dn ]
CN = TeksERP OTA
[ ota_kok ]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[ ota_yaprak ]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
`;

/* ------------------------------------------------------------------ *
 * DER — X509Certificate bit düzeyinde keyUsage/basicConstraints vermez; uzantılar elle okunur
 * ------------------------------------------------------------------ */

function tlv(b, o) {
  if (o + 2 > b.length) throw new Error('DER kesik');
  let uz = b[o + 1];
  let bas = o + 2;
  if (uz & 0x80) {
    const n = uz & 0x7f;
    uz = 0;
    for (let i = 0; i < n; i++) uz = uz * 256 + b[o + 2 + i];
    bas = o + 2 + n;
  }
  if (bas + uz > b.length) throw new Error('DER uzunluğu taşıyor');
  return { etiket: b[o], bas, son: bas + uz };
}
function cocuklar(b, t) {
  const c = [];
  for (let o = t.bas; o < t.son;) {
    const x = tlv(b, o);
    c.push(x);
    o = x.son;
  }
  return c;
}
function oidOku(b, t) {
  const v = b.subarray(t.bas, t.son);
  const p = [Math.min(2, Math.floor(v[0] / 40)), v[0] - Math.min(2, Math.floor(v[0] / 40)) * 40];
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    n = n * 128 + (v[i] & 0x7f);
    if (!(v[i] & 0x80)) { p.push(n); n = 0; }
  }
  return p.join('.');
}

/**
 * Sertifikanın imza açısından önemli uzantıları.
 * @returns {{ca: boolean, pathLen: number|null, digitalSignature: boolean, keyCertSign: boolean, keyUsageVar: boolean,
 *             eku: string[]|null, expoProje: boolean}}
 */
function uzantilar(x509) {
  const b = x509.raw;
  const sertifika = tlv(b, 0);
  const tbs = cocuklar(b, sertifika)[0];
  const ekKap = cocuklar(b, tbs).find((t) => t.etiket === 0xa3);
  const s = { ca: false, pathLen: null, digitalSignature: false, keyCertSign: false, keyUsageVar: false, eku: null, expoProje: false };
  if (!ekKap) return s;
  for (const ek of cocuklar(b, cocuklar(b, ekKap)[0])) {
    const k = cocuklar(b, ek);
    const oid = oidOku(b, k[0]);
    const ic = tlv(b, k[k.length - 1].bas);
    if (oid === '2.5.29.15') {
      s.keyUsageVar = true;
      const ilk = ic.son - ic.bas > 1 ? b[ic.bas + 1] : 0;
      s.digitalSignature = (ilk & 0x80) !== 0;
      s.keyCertSign = (ilk & 0x04) !== 0;
    } else if (oid === '2.5.29.19') {
      for (const c of cocuklar(b, ic)) {
        if (c.etiket === 0x01) s.ca = b[c.bas] !== 0;
        else if (c.etiket === 0x02) s.pathLen = b.subarray(c.bas, c.son).reduce((a, x) => a * 256 + x, 0);
      }
    } else if (oid === '2.5.29.37') {
      s.eku = cocuklar(b, ic).map((c) => oidOku(b, c));
    } else if (oid === EXPO_PROJE_OID) {
      s.expoProje = true;
    }
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Ortak yardımcılar
 * ------------------------------------------------------------------ */

/** Metindeki PEM sertifikaları sırayla (CodeSigningConfiguration.kt `separateCertificateChain` aynası). */
function pemAyir(metin) {
  return String(metin ?? '').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}
function x509(pem) {
  return new crypto.X509Certificate(String(pem));
}
const tarih = (x, ad) => x[`${ad}Date`] ?? new Date(x[ad]);
function gecerlilikHatasi(x, simdi) {
  const bas = tarih(x, 'validFrom');
  const bit = tarih(x, 'validTo');
  if (simdi < bas) return `henüz geçerli değil (başlangıç ${bas.toISOString()}; cihaz saati gerideyse OTA inmez)`;
  if (simdi > bit) return `SÜRESİ GEÇMİŞ (bitiş ${bit.toISOString()})`;
  return null;
}
const ozImzali = (x) => x.issuer === x.subject && x.verify(x.publicKey);
const rsaBit = (x) => (x.publicKey.asymmetricKeyType === 'rsa' ? x.publicKey.asymmetricKeyDetails?.modulusLength ?? 0 : 0);
/** Java `X509Certificate.getBasicConstraints()`: CA değilse -1, pathLen yoksa sınırsız. */
const javaBasicConstraints = (u) => (u.ca ? u.pathLen ?? Number.MAX_SAFE_INTEGER : -1);

/* ------------------------------------------------------------------ *
 * Kök ve yaprak denetimi (yayın aracı · derleme · eklenti · tören)
 * ------------------------------------------------------------------ */

/** APK'ya gömülecek OTA KÖKÜ mü? Hata satırları (boş = kök). */
function kokHatalari(pem, { simdi = new Date() } = {}) {
  let x;
  try {
    x = x509(pem);
  } catch (e) {
    return [`OTA kökü X.509 olarak okunamadı (${e.message})`];
  }
  const h = [];
  const u = uzantilar(x);
  if (rsaBit(x) < KOK_RSA_ASGARI) h.push(`OTA kökü RSA-${KOK_RSA_ASGARI}+ değil (expo yalnız SHA256withRSA doğrular)`);
  if (!ozImzali(x)) h.push('OTA kökü öz-imzalı değil');
  if (!u.ca || !x.ca) h.push('OTA kökü CA DEĞİL (basicConstraints CA:TRUE yok) — zincirde istemci RED verir');
  if (!u.keyCertSign) h.push('OTA kökünde keyUsage keyCertSign yok — zincirde istemci RED verir');
  if (u.ca && u.pathLen !== 0) h.push(`OTA kökü pathLen ${u.pathLen ?? '(sınırsız)'} — 0 olmalı (yalnız yaprak basar)`);
  if (u.eku !== null) h.push(`OTA kökü EKU taşıyor (${u.eku.join(', ')}) — kök kendisi imzacı OLAMAZ, EKU'suz olmalı`);
  if (u.digitalSignature) h.push('OTA kökünde keyUsage digitalSignature var — kök manifest imzalamaz');
  if (u.expoProje) h.push('OTA kökü Expo proje uzantısı taşıyor — kullanılmaz');
  const g = gecerlilikHatasi(x, simdi);
  if (g) h.push(`OTA kökü ${g}`);
  return h;
}

/**
 * OTA YAPRAĞI bu köke bağlı geçerli bir imzacı mı? `esikGun` > 0 ise bitişe o kadar günden az kalmışsa da hata.
 * @returns {string[]} hata satırları (boş = imzalayabilir)
 */
function yaprakHatalari(yaprakPem, kokPem, { simdi = new Date(), esikGun = 0 } = {}) {
  let y;
  let k;
  try {
    y = x509(yaprakPem);
  } catch (e) {
    return [`OTA yaprağı X.509 olarak okunamadı (${e.message})`];
  }
  try {
    k = x509(kokPem);
  } catch (e) {
    return [`OTA kökü X.509 olarak okunamadı (${e.message})`];
  }
  const h = [];
  const u = uzantilar(y);
  if (rsaBit(y) < YAPRAK_RSA_ASGARI) h.push(`OTA yaprağı RSA-${YAPRAK_RSA_ASGARI}+ değil`);
  if (u.ca || y.ca) h.push('OTA yaprağı CA — yaprak CA OLAMAZ (CA:FALSE)');
  if (!u.digitalSignature) h.push('OTA yaprağında keyUsage digitalSignature yok — istemci RED verir');
  if (!(u.eku ?? []).includes(CODE_SIGNING_OID)) h.push('OTA yaprağında EKU codeSigning yok — istemci RED verir');
  if (u.expoProje) h.push('OTA yaprağı Expo proje uzantısı taşıyor — kullanılmaz');
  if (y.fingerprint256 === k.fingerprint256 || ozImzali(y)) h.push('OTA yaprağı öz-imzalı / kökün kendisi — yaprak kökçe basılır');
  if (y.issuer !== k.subject || !y.verify(k.publicKey)) h.push('OTA yaprağı bu OTA köküyle ZİNCİRLENMİYOR (veren/imza tutmuyor)');
  const g = gecerlilikHatasi(y, simdi);
  if (g) h.push(`OTA yaprağı ${g}`);
  const omur = (tarih(y, 'validTo') - tarih(y, 'validFrom')) / GUN;
  if (omur > OTA_YAPRAK_GUN + 1e-6) h.push(`OTA yaprağı ömrü ${omur.toFixed(1)} gün — en çok ${OTA_YAPRAK_GUN} gün`);
  if (!g && esikGun > 0) {
    const kalan = (tarih(y, 'validTo') - simdi) / GUN;
    if (kalan < esikGun) h.push(`OTA yaprağının bitişine ${kalan.toFixed(1)} gün kaldı (< ${esikGun}) — yıllık törende yeni yaprak basılır, bununla İMZALANMAZ`);
  }
  if (!h.length) {
    try {
      istemciZinciri([yaprakPem, kokPem], { simdi });
    } catch (e) {
      h.push(`istemci aynası zinciri reddetti: ${e.message}`);
    }
  }
  return h;
}

/**
 * expo-updates `CertificateChain` aynası: `[yaprak, ara…, gömülü]`. Geçerse imzacı (ilk halka) X509Certificate döner.
 * @throws {Error} istemcinin reddedeceği her durumda
 */
function istemciZinciri(pemler, { simdi = new Date() } = {}) {
  if (!pemler.length) throw new Error('zincirde sertifika yok');
  const z = pemler.map((p, i) => {
    let x;
    try {
      x = x509(p);
    } catch (e) {
      throw new Error(`zincirin ${i}. halkası okunamadı (${e.message})`);
    }
    const g = gecerlilikHatasi(x, simdi);
    if (g) throw new Error(`zincirin ${i}. halkası ${g}`);
    return x;
  });
  for (let i = 0; i < z.length - 1; i++) {
    if (z[i].issuer !== z[i + 1].subject || !z[i].verify(z[i + 1].publicKey)) throw new Error('sertifikalar zincirlenmiyor');
  }
  const son = z[z.length - 1];
  if (!ozImzali(son)) throw new Error('kök sertifika öz-imzalı değil');
  const uz = z.map(uzantilar);
  if (uz.some((u) => u.expoProje)) throw new Error('Expo proje uzantısı taşıyan halka (kullanılmaz)');
  if (z.length > 1) {
    const ku = uz[uz.length - 1];
    if (!(javaBasicConstraints(ku) > -1 && ku.keyCertSign)) throw new Error('kök sertifika CA değil');
    let yol = javaBasicConstraints(ku);
    for (let i = z.length - 2; i >= 1; i--) {
      if (!(javaBasicConstraints(uz[i]) > -1 && uz[i].keyCertSign)) throw new Error('ara halka CA değil');
      if (yol <= 0) throw new Error('pathLen kısıtı aşıldı');
      yol = Math.min(javaBasicConstraints(uz[i]), yol - 1);
    }
  }
  if (!(uz[0].keyUsageVar && uz[0].digitalSignature && (uz[0].eku ?? []).includes(CODE_SIGNING_OID))) {
    throw new Error('ilk halka kod imzalama sertifikası değil (digitalSignature + EKU codeSigning gerekli)');
  }
  return z[0];
}

/** Özel anahtar bu yaprak sertifikanın mı? */
function anahtarYaprakEslesir(anahtar, yaprakPem) {
  const a = crypto.createPublicKey(anahtar).export({ type: 'spki', format: 'der' });
  return a.equals(x509(yaprakPem).publicKey.export({ type: 'spki', format: 'der' }));
}
const pemSifreli = (metin) => /-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(String(metin));

/* ------------------------------------------------------------------ *
 * Tören komutları (openssl; yeni npm paketi YOK) — metin ve deneme üretimi AYNI argv'den
 * ------------------------------------------------------------------ */

/**
 * Tören adımları argv dizileri olarak. `parola` verilirse (yalnız deneme zinciri) openssl'e argümanla geçer;
 * törende verilmez, openssl parolayı kendisi gizli sorar. Yollar çağıranın çalışma dizinine görelidir.
 */
function torenKomutlari({ kokAnahtar, kokSertifika, yaprakAnahtar, yaprakSertifika, csr, profil, seri = `0x${crypto.randomBytes(16).toString('hex')}`,
  kokBolum = 'ota_kok', yaprakBolum = 'ota_yaprak', kokGun = OTA_KOK_GUN, yaprakGun = OTA_YAPRAK_GUN, yaprakCn = 'TeksERP OTA Yaprak', parola = null, kokParola = parola }) {
  const yeni = (p) => (p ? ['-pass', `pass:${p}`] : []);
  const ac = (p) => (p ? ['-passin', `pass:${p}`] : []);
  return [
    ['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-aes-256-cbc', ...yeni(kokParola), '-out', kokAnahtar],
    ['openssl', 'req', '-x509', '-new', '-key', kokAnahtar, ...ac(kokParola), '-sha256', '-days', String(kokGun), '-subj', '/CN=TeksERP OTA Kok',
      '-config', profil, '-extensions', kokBolum, '-out', kokSertifika],
    ['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-aes-256-cbc', ...yeni(parola), '-out', yaprakAnahtar],
    ['openssl', 'req', '-new', '-key', yaprakAnahtar, ...ac(parola), '-subj', `/CN=${yaprakCn}`, '-config', profil, '-out', csr],
    ['openssl', 'x509', '-req', '-in', csr, '-CA', kokSertifika, '-CAkey', kokAnahtar, ...ac(kokParola), '-set_serial', seri, '-sha256',
      '-days', String(yaprakGun), '-extfile', profil, '-extensions', yaprakBolum, '-out', yaprakSertifika],
  ];
}
const kabukAlinti = (a) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : `"${a.replace(/(["\\$`])/g, '\\$1')}"`);
const komutMetni = (argv) => argv.map(kabukAlinti).join(' ');

/**
 * ATILACAK deneme zinciri (bekçi ve `--kuru`): `dizin` altına profil + kök + yaprak; parola `deneme`.
 * Gerçek anahtar DEĞİLDİR, depoya girmez. openssl yoksa fırlatır.
 * @returns {{kokPem: string, yaprakPem: string, yaprakAnahtarPem: string, kokAnahtarPem: string, parola: string, yollar: object}}
 */
function denemeZinciriUret(dizin, { profilEk = '', parola = 'deneme', ...secim } = {}) {
  fs.mkdirSync(dizin, { recursive: true });
  const y = {
    profil: path.join(dizin, 'ota-profil.cnf'),
    kokAnahtar: path.join(dizin, 'kok-anahtar.pem'),
    kokSertifika: path.join(dizin, 'kok.pem'),
    yaprakAnahtar: path.join(dizin, 'yaprak-anahtar.pem'),
    yaprakSertifika: path.join(dizin, 'yaprak.pem'),
    csr: path.join(dizin, 'yaprak.csr'),
  };
  fs.writeFileSync(y.profil, OPENSSL_PROFILI + profilEk);
  for (const [komut, ...a] of torenKomutlari({ ...y, parola, ...secim })) {
    execFileSync(komut, a, { stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const oku = (p) => fs.readFileSync(p, 'utf8');
  return { kokPem: oku(y.kokSertifika), yaprakPem: oku(y.yaprakSertifika), yaprakAnahtarPem: oku(y.yaprakAnahtar), kokAnahtarPem: oku(y.kokAnahtar), parola, yollar: y };
}

module.exports = {
  ZINCIR_META,
  ZINCIR_PARCASI,
  CODE_SIGNING_OID,
  OTA_KOK_GUN,
  OTA_YAPRAK_GUN,
  OTA_YAPRAK_ESIK_GUN,
  OPENSSL_PROFILI,
  uzantilar,
  pemAyir,
  kokHatalari,
  yaprakHatalari,
  istemciZinciri,
  anahtarYaprakEslesir,
  pemSifreli,
  torenKomutlari,
  komutMetni,
  denemeZinciriUret,
};
