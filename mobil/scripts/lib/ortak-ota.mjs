// =============================================================================
// TEK ORTAK PAKET — tablet OTA: ortak paket denetimi + grup manifesti (O10b) · zero-dep
// =============================================================================
// Ortak OTA paketi (`ota-cikti/ortak/<rv>/<damga>/`) bir kez derlenir: bundle + varlıklar + `metadata.json` +
// `expoConfig.json` + `yayin.json`. İÇİNDE MANİFEST YOKTUR: manifest her grup için YENİDEN üretilir ve imzalanır
// (varlık adresleri `<kök><grup>/mobil/ota/<rv>/<damga>/…`), böylece paket baytı gruplar arasında AYNI kalır,
// manifest/imza hedef grubun olur (TEK-ORTAK-PAKET.md §S3). Kimlik (runtimeVersion · imza anahtarı kimliği · sertifika)
// `app.json`dan DEĞİL ortak kimlikten (`ortak-kimlik.cjs`) gelir.
//
// Saf yükümler burada, süreç/ağ işi `yayinla-ota-ortak.mjs` ve `deploy/mobil-grup-yayinla.mjs`te.
// Bekçi: scripts/test_grup_yayin_tablet.mjs
// =============================================================================

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { ortakBundleAdresleri } from './adres.mjs';
import { imzaBasligi, manifestKur, multipartDogrula, multipartKur } from './manifest.mjs';

const require = createRequire(import.meta.url);
const { anahtarToreniKomutu, ortakYapilandirmaFarki } = require('./ortak-kimlik.cjs');

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
 * Ortak OTA imza anahtarı + sertifikası. Yoksa fail-closed ve tören komutunu söyler; `kuru` ise KURU SAHTE bir çift
 * üretir (yalnız imza adımının çalıştığını göstermek için — çıktı asla yayına gitmez, `sahte: true`).
 * @returns {{anahtarPem: string, sertifikaPem: string, keyid: string, sahte: boolean}}
 */
export function ortakImzaAnahtari(kimlik, mobilKok, { kuru = false, anahtarYolu } = {}) {
  const anahtarYol = anahtarYolu ? path.resolve(anahtarYolu) : path.join(mobilKok, kimlik.otaAnahtar);
  const sertYol = path.join(mobilKok, kimlik.otaSertifika);
  const var_ = fs.existsSync(anahtarYol) && fs.existsSync(sertYol);
  if (!var_) {
    if (kuru) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      return {
        anahtarPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        sertifikaPem: publicKey.export({ type: 'spki', format: 'pem' }),
        keyid: kimlik.anahtarKimligi,
        sahte: true,
      };
    }
    throw new OrtakOtaIhlali('ORTAK OTA İMZA ANAHTARI/SERTİFİKASI YOK — manifest imzalanamaz, yayın yapılmaz', [
      `beklenen anahtar    : ${anahtarYol}`,
      `beklenen sertifika  : ${sertYol}`,
      'Anahtar çifti kullanıcıyla töreni ile üretilir (git dışı, yedekli); üretilmeden OTA yayını çıkmaz:',
      ...anahtarToreniKomutu(kimlik).map((k) => `  ${k}`),
    ]);
  }
  return { anahtarPem: fs.readFileSync(anahtarYol, 'utf8'), sertifikaPem: fs.readFileSync(sertYol, 'utf8'), keyid: kimlik.anahtarKimligi, sahte: false };
}

/**
 * Hedef grubun manifesti: varlık adresleri GRUBUN, imza ortak anahtarla, gövde istemcinin yaptığı gibi doğrulanır.
 * Aynı paket farklı gruba üretilince yalnız adresler (ve imza) değişir; `id` metadata'dan türer, aynı kalır.
 * @returns {{govde: Buffer, manifest: object, imzalayan: {keyid: string, sahte: boolean}}}
 */
export function grupManifestiUret({ paketDizin, kunye, expoConfig, feed, anahtar }) {
  const varlikTabani = grupVarlikTabani(feed, kunye.runtimeVersion, kunye.damga);
  const manifest = manifestKur({ paketDizin, runtimeVersion: kunye.runtimeVersion, damga: kunye.damga, varlikTabani, expoConfig });
  const govde = multipartKur({ manifest, imzaBasligiDegeri: imzaBasligi(JSON.stringify(manifest), anahtar.anahtarPem, anahtar.keyid) });
  let d;
  try {
    d = multipartDogrula(govde, anahtar.sertifikaPem);
  } catch (e) {
    throw new OrtakOtaIhlali(`üretilen manifest imzası sertifikayla DOĞRULANMADI: ${e.message}`);
  }
  if (!d.imzali) throw new OrtakOtaIhlali('üretilen manifest imzasız');
  if (d.manifest.runtimeVersion !== kunye.runtimeVersion) throw new OrtakOtaIhlali('manifest runtimeVersion tutmuyor');
  const yabanci = [d.manifest.launchAsset, ...d.manifest.assets].map((v) => v.url).filter((u) => !u.startsWith(`${varlikTabani}/`));
  if (yabanci.length) throw new OrtakOtaIhlali(`manifest hedef grubun dışında adres taşıyor: ${yabanci[0]}`);
  return { govde, manifest: d.manifest, imzalayan: { keyid: anahtar.keyid, sahte: anahtar.sahte } };
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
    return { sonuc: 'ihlal', satirlar: ['NATIVE DEĞİŞTİ ama runtimeVersion AYNI — bu paket sahadaki tabletleri açılışta çökertir', 'runtimeVersion değeri deploy/dagitim.json urun.tablet.runtimeVersion\'dır: artır ve yeni APK derle'] };
  }
  if (rvDegisti) return { sonuc: 'rv-degisti', satirlar: [`runtimeVersion ${onceki.runtimeVersion} → ${runtimeVersion}: paket yalnız yeni APK kurulu tabletlere gider`] };
  return { sonuc: 'ayni', satirlar: ['native parmak izi değişmedi'] };
}
