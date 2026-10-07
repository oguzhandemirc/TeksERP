// =============================================================================
// TEK ORTAK PAKET — tablet OTA: ortak paket denetimi + grup manifesti (O10b) · zero-dep
// =============================================================================
// Ortak OTA paketi (`ota-cikti/ortak/<rv>/<damga>/`) bir kez derlenir: bundle + varlıklar + `metadata.json` +
// `expoConfig.json` + `yayin.json`. İÇİNDE MANİFEST YOKTUR: manifest her grup için YENİDEN üretilir ve imzalanır
// (varlık adresleri `<kök><grup>/mobil/ota/<rv>/<damga>/…`), böylece paket baytı gruplar arasında AYNI kalır,
// manifest/imza hedef grubun olur (TEK-ORTAK-PAKET.md §S3). Kimlik (runtimeVersion · imza anahtarı kimliği · sertifika)
// `app.json`dan DEĞİL ortak kimlikten (`ortak-kimlik.cjs`) gelir.
// İmza (K-2): manifesti parolalı OTA YAPRAĞI imzalar, yaprak `certificate_chain` parçasında gider; tablet onu APK'ya
// gömülü OTA KÖKÜNE zincirler (`ota-zinciri.cjs`, docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.1, §3.5).
//
// Saf yükümler burada, süreç/ağ işi `yayinla-ota-ortak.mjs` ve `deploy/mobil-grup-yayinla.mjs`te.
// Bekçi: scripts/test_grup_yayin_tablet.mjs
// =============================================================================

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { ortakBundleAdresleri } from './adres.mjs';
import { imzaBasligi, manifestKur, multipartDogrula, multipartKur } from './manifest.mjs';

const require = createRequire(import.meta.url);
const { anahtarToreniKomutu, ortakYapilandirmaFarki } = require('./ortak-kimlik.cjs');
const Z = require('./ota-zinciri.cjs');

/** Ortak paketin yerel künyesi; `ortak: true` ve manifest YOKLUĞU ortak pakettir. */
export const PAKET_KUNYESI = 'yayin.json';
/** Grup başına üretilen manifestin yazıldığı alt dizin (ortak paketin kendisi değişmez). */
export const GRUP_ALT_DIZINI = '_grup';
export const DAMGA = /^\d{13}$/;

export class OrtakOtaIhlali extends Error {
  constructor(mesaj, satirlar = []) {
    super(mesaj);
    this.satirlar = satirlar;
  }
}

const oku = (yol) => JSON.parse(fs.readFileSync(yol, 'utf8'));

/**
 * Ortak OTA paket dizini ortak paket mi? Hata listesi (boş = tamam). Okunamayan dosya `OrtakOtaIhlali` fırlatır
 * (çağıran ÖLÇÜLEMEDİ = DUR sayar).
 * @returns {{kunye: object, expoConfig: object, bundleYolu: string, hatalar: string[]}}
 */
export function ortakPaketDenetimi(dizin, kimlik) {
  const hatalar = [];
  let kunye;
  let expoConfig;
  let meta;
  try {
    kunye = oku(path.join(dizin, PAKET_KUNYESI));
    expoConfig = oku(path.join(dizin, 'expoConfig.json'));
    meta = oku(path.join(dizin, 'metadata.json'));
  } catch (e) {
    throw new OrtakOtaIhlali(`ortak OTA paketi okunamadı (${dizin}): ${e.message}`, ['Beklenen: yayin.json · expoConfig.json · metadata.json — önce mobil/scripts/yayinla-ota-ortak.mjs']);
  }
  if (kunye.ortak !== true) hatalar.push('yayin.json `ortak: true` değil — bu paket eski kanal paketi (kanala bağlı manifest taşır)');
  if (kunye.musteri !== undefined) hatalar.push(`yayin.json müşteri/kanal alanı taşıyor ("${kunye.musteri}") — ortak paket kanalsızdır`);
  if (kunye.adres !== undefined && kunye.adres !== null) hatalar.push(`yayin.json ERP adresi taşıyor ("${kunye.adres}") — ortak paket adres gömmez`);
  if (kunye.runtimeVersion !== kimlik.runtimeVersion) hatalar.push(`runtimeVersion "${kunye.runtimeVersion}" — ortak kimlik "${kimlik.runtimeVersion}" bekliyor`);
  if (!DAMGA.test(String(kunye.damga))) hatalar.push(`damga biçimsiz: "${kunye.damga}"`);
  else if (path.basename(path.resolve(dizin)) !== kunye.damga) hatalar.push(`klasör adı (${path.basename(path.resolve(dizin))}) künyedeki damgayla (${kunye.damga}) uyuşmuyor`);
  const manifestler = fs.readdirSync(dizin).filter((ad) => ad === 'manifest' || ad.startsWith('manifest-'));
  if (manifestler.length) hatalar.push(`pakette manifest var (${manifestler.join(', ')}) — ortak pakette manifest GRUP başına üretilir, pakete yazılmaz`);
  hatalar.push(...ortakYapilandirmaFarki(expoConfig, { herkese: true }, kimlik).map((x) => `expoConfig.json ${x}`));
  const bundleRel = meta?.fileMetadata?.android?.bundle;
  if (!bundleRel) hatalar.push('metadata.json android bundle yolu taşımıyor');
  const bundleYolu = bundleRel ? path.join(dizin, bundleRel) : null;
  if (bundleYolu) {
    if (kunye.bundle !== bundleRel) hatalar.push(`yayin.json bundle "${kunye.bundle}" ≠ metadata.json "${bundleRel}"`);
    let veri = null;
    try {
      veri = fs.readFileSync(bundleYolu);
    } catch (e) {
      throw new OrtakOtaIhlali(`ortak OTA paketinin bundle'ı okunamadı: ${bundleYolu} (${e.message})`);
    }
    const { gomulu } = ortakBundleAdresleri(veri.toString('latin1'));
    if (gomulu.length) hatalar.push(`bundle'da ERP adresi var (${gomulu.slice(0, 3).join(', ')}) — tek paket her fabrikaya gider`);
  }
  return { kunye, expoConfig, bundleYolu, hatalar };
}

/** Grubun varlık adresi tabanı (sonu `/` DEĞİL): `<feed>ota/<rv>/<damga>`; `feed` dağıtım kaydından türer (sonu `/`). */
export const grupVarlikTabani = (feed, rv, damga) => `${String(feed).replace(/\/+$/, '')}/ota/${rv}/${damga}`;

/**
 * Ortak OTA imza malzemesinin yolları: APK'ya gömülü OTA KÖKÜ + manifesti imzalayan OTA YAPRAĞI (anahtar + sertifika).
 * `anahtarYolu` (yedek yaprak, USB) verilirse yaprak sertifikası o anahtarın YANINDAN okunur — aynı dizin düzeni.
 */
export function ortakImzaYollari(kimlik, mobilKok, { anahtarYolu } = {}) {
  const anahtarYol = anahtarYolu ? path.resolve(anahtarYolu) : path.join(mobilKok, kimlik.otaAnahtar);
  const yaprakYol = anahtarYolu ? path.join(path.dirname(anahtarYol), path.basename(kimlik.otaYaprak)) : path.join(mobilKok, kimlik.otaYaprak);
  return { anahtarYol, yaprakYol, kokYol: path.join(mobilKok, kimlik.otaSertifika) };
}

/** Yaprak anahtarı var ve parolalı mı (yayıncı parolayı yalnız o zaman sorar). */
export function ortakAnahtarParolali(yollar) {
  try {
    return Z.pemSifreli(fs.readFileSync(yollar.anahtarYol, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Ortak OTA imza malzemesi: yaprak anahtarı (açılmış KeyObject) + yaprak + kök PEM. Fail-closed: dosya yoksa tören
 * komutuyla; yaprak anahtarı PAROLASIZSA, parola yoksa/yanlışsa, kök CA değilse, yaprak köke bağlı değilse, süresi
 * bitmişse ya da bitişine 30 günden az kalmışsa ya da anahtar yaprağın değilse DURUR. `kuru` + malzeme yoksa ATILACAK
 * bir deneme zinciri üretir (openssl; `sahte: true`, çıktı yayına gitmez).
 * @returns {{anahtar: crypto.KeyObject, kokPem: string, yaprakPem: string, keyid: string, sahte: boolean, yaprakBitis: string}}
 */
export function ortakImzaAnahtari(kimlik, mobilKok, { kuru = false, anahtarYolu, parola, simdi = new Date() } = {}) {
  const y = ortakImzaYollari(kimlik, mobilKok, { anahtarYolu });
  const eksik = [y.anahtarYol, y.yaprakYol, y.kokYol].filter((p) => !fs.existsSync(p));
  if (eksik.length) {
    if (kuru) return denemeImzaMalzemesi(kimlik);
    throw new OrtakOtaIhlali('ORTAK OTA İMZA MALZEMESİ YOK — manifest imzalanamaz, yayın yapılmaz', [
      `OTA kökü (APK'ya gömülü) : ${y.kokYol}`,
      `OTA yaprağı sertifikası  : ${y.yaprakYol}`,
      `OTA yaprağı anahtarı     : ${y.anahtarYol}`,
      `eksik                    : ${eksik.join(', ')}`,
      'Zincir kullanıcıyla törende üretilir (git dışı, yedekli); üretilmeden OTA yayını çıkmaz:',
      ...anahtarToreniKomutu(kimlik).map((k) => `  ${k}`),
    ]);
  }
  const anahtarPem = fs.readFileSync(y.anahtarYol, 'utf8');
  if (!Z.pemSifreli(anahtarPem)) {
    throw new OrtakOtaIhlali('OTA YAPRAK ANAHTARI PAROLASIZ — imzalanmaz', [
      `anahtar: ${y.anahtarYol}`,
      'Yaprak anahtarı parolalı PKCS#8 olmalı (BEGIN ENCRYPTED PRIVATE KEY); tören komutu `-aes-256-cbc` ile üretir.',
    ]);
  }
  if (!parola) throw new OrtakOtaIhlali('OTA YAPRAK ANAHTARI PAROLASI VERİLMEDİ — imzalanmaz', [`anahtar: ${y.anahtarYol}`]);
  let anahtar;
  try {
    anahtar = crypto.createPrivateKey({ key: anahtarPem, passphrase: parola });
  } catch {
    throw new OrtakOtaIhlali('OTA YAPRAK ANAHTARI AÇILAMADI — parola yanlış ya da dosya bozuk', [`anahtar: ${y.anahtarYol}`]);
  }
  const kokPem = fs.readFileSync(y.kokYol, 'utf8');
  const yaprakPem = fs.readFileSync(y.yaprakYol, 'utf8');
  const h = [...Z.kokHatalari(kokPem, { simdi }), ...Z.yaprakHatalari(yaprakPem, kokPem, { simdi, esikGun: Z.OTA_YAPRAK_ESIK_GUN })];
  if (!h.length && !Z.anahtarYaprakEslesir(anahtar, yaprakPem)) h.push(`yaprak anahtarı bu yaprak sertifikasının değil (${y.anahtarYol} ↔ ${y.yaprakYol})`);
  if (h.length) throw new OrtakOtaIhlali('OTA SERTİFİKA ZİNCİRİ İMZAYA UYGUN DEĞİL — manifest imzalanmaz', h.map((x) => `• ${x}`));
  return { anahtar, kokPem, yaprakPem, keyid: kimlik.anahtarKimligi, sahte: false, yaprakBitis: new crypto.X509Certificate(yaprakPem).validTo };
}

/** `--kuru`: atılacak deneme zinciri (openssl) — yalnız imza adımının çalıştığını gösterir, hiçbir yere yazılmaz. */
function denemeImzaMalzemesi(kimlik) {
  const dizin = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-ota-kuru-'));
  try {
    const d = Z.denemeZinciriUret(dizin);
    const anahtar = crypto.createPrivateKey({ key: d.yaprakAnahtarPem, passphrase: d.parola });
    return { anahtar, kokPem: d.kokPem, yaprakPem: d.yaprakPem, keyid: kimlik.anahtarKimligi, sahte: true, yaprakBitis: new crypto.X509Certificate(d.yaprakPem).validTo };
  } catch (e) {
    throw new OrtakOtaIhlali(`KURU: deneme OTA zinciri üretilemedi (openssl gerekli): ${e.message}`);
  } finally {
    fs.rmSync(dizin, { recursive: true, force: true });
  }
}

/**
 * Hedef grubun manifesti: varlık adresleri GRUBUN, imza OTA yaprağıyla, yaprak `certificate_chain` parçasında; gövde
 * istemcinin yaptığı gibi GÖMÜLÜ KÖKE karşı zincirle doğrulanır. Aynı paket farklı gruba üretilince yalnız adresler
 * (ve imza) değişir; `id` metadata'dan türer, aynı kalır.
 * @returns {{govde: Buffer, manifest: object, imzalayan: {keyid: string, sahte: boolean, yaprakBitis: string}}}
 */
export function grupManifestiUret({ paketDizin, kunye, expoConfig, feed, anahtar }) {
  const varlikTabani = grupVarlikTabani(feed, kunye.runtimeVersion, kunye.damga);
  const manifest = manifestKur({ paketDizin, runtimeVersion: kunye.runtimeVersion, damga: kunye.damga, varlikTabani, expoConfig });
  const govde = multipartKur({
    manifest,
    imzaBasligiDegeri: imzaBasligi(JSON.stringify(manifest), anahtar.anahtar, anahtar.keyid),
    sertifikaZinciri: anahtar.yaprakPem,
  });
  let d;
  try {
    d = multipartDogrula(govde, anahtar.kokPem, { zincir: true });
  } catch (e) {
    throw new OrtakOtaIhlali(`üretilen manifest OTA köküne karşı DOĞRULANMADI: ${e.message}`);
  }
  if (!d.imzali || !d.zincirli) throw new OrtakOtaIhlali('üretilen manifest imzasız ya da sertifika zinciri parçasız');
  if (d.manifest.runtimeVersion !== kunye.runtimeVersion) throw new OrtakOtaIhlali('manifest runtimeVersion tutmuyor');
  const yabanci = [d.manifest.launchAsset, ...d.manifest.assets].map((v) => v.url).filter((u) => !u.startsWith(`${varlikTabani}/`));
  if (yabanci.length) throw new OrtakOtaIhlali(`manifest hedef grubun dışında adres taşıyor: ${yabanci[0]}`);
  return { govde, manifest: d.manifest, imzalayan: { keyid: anahtar.keyid, sahte: anahtar.sahte, yaprakBitis: anahtar.yaprakBitis } };
}

/**
 * Native parmak izi, DEĞERLENDİRİLMİŞ ortak yapılandırmadan (`app.config.js` çıktısı): `app.json` eski kanalın
 * kimliğini taşır, ortak paketin paket adı/runtime'ı ondan gelmez — o yüzden app.json'un ham android bloğu hash'lenmez.
 * Kapsam: bağımlılıklar · plugins · android − versionCode · depo içi native kaynak (`yerelNativeKaynakIzi`; alg 4).
 */
export const ORTAK_PARMAK_IZI_ALG = 4;
export function ortakNativeParmakIzi(degerlendirilmis, bagimliliklar, yerelNative = null) {
  const { versionCode: _vc, ...androidKalan } = degerlendirilmis?.android ?? {};
  const girdi = JSON.stringify({ bagimliliklar, plugins: degerlendirilmis?.plugins, android: androidKalan, runtimeVersion: degerlendirilmis?.runtimeVersion, yerelNative });
  return crypto.createHash('sha256').update(girdi).digest('hex').slice(0, 16);
}

/**
 * Depo içi native kaynağın özeti: `modules/` (yerel Expo modülleri, ör. TeksErpLanTls Kotlin'i) ve `plugins/`
 * altındaki git'te izlenen dosyaların yolu + içeriği. Bağımlılık/plugin listesi bu dosyaların içeriğini görmez;
 * görmezse Kotlin değişikliği runtimeVersion artmadan OTA'ya sızar. git okunamazsa kapı ölçemez → hata.
 */
export function yerelNativeKaynakIzi(kok) {
  const liste = execFileSync('git', ['ls-files', '-z', '--', 'modules', 'plugins'], { cwd: kok, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .sort();
  const h = crypto.createHash('sha256');
  for (const f of liste) {
    h.update(f).update('\0');
    h.update(crypto.createHash('sha256').update(fs.readFileSync(path.join(kok, f))).digest('hex')).update('\n');
  }
  return `${liste.length}:${h.digest('hex').slice(0, 16)}`;
}

/**
 * Parmak izi kapısı hükmü (saf). native değişti + runtimeVersion aynı → DUR (sahadaki tabletler çöker).
 * @returns {{sonuc: 'ilk'|'ayni'|'rv-degisti'|'ihlal'|'alg', satirlar: string[]}}
 */
export function parmakIziHukmu({ onceki, simdiki, runtimeVersion, kabul = false }) {
  if (!onceki) return { sonuc: 'ilk', satirlar: ['ilk koşum — karşılaştırılacak önceki kayıt yok'] };
  if ((onceki.alg ?? 1) !== ORTAK_PARMAK_IZI_ALG && !kabul) {
    return { sonuc: 'alg', satirlar: [`kayıtlı taban algoritması ${onceki.alg ?? 1} ≠ ${ORTAK_PARMAK_IZI_ALG}: kıyaslanamaz (native değişti DEMEK DEĞİL) — --parmak-izini-kabul-et ile tabanı yenile`] };
  }
  const nativeDegisti = onceki.parmakIzi !== simdiki;
  const rvDegisti = onceki.runtimeVersion !== runtimeVersion;
  if (nativeDegisti && !rvDegisti && !kabul) {
    return { sonuc: 'ihlal', satirlar: ['NATIVE DEĞİŞTİ ama runtimeVersion AYNI — bu paket sahadaki tabletleri açılışta çökertir', 'runtimeVersion artır (deploy/dagitim.json urun.tablet.runtimeVersion) → AAB derle (cd mobil && npm run build:aab) → Play\'e yükle (Play Console, gizli yayın)'] };
  }
  if (rvDegisti) return { sonuc: 'rv-degisti', satirlar: [`runtimeVersion ${onceki.runtimeVersion} → ${runtimeVersion}: paket yalnız Play'den yeni sürümü kurmuş tabletlere gider`] };
  return { sonuc: 'ayni', satirlar: ['native parmak izi değişmedi'] };
}
