// =============================================================================
// TeksERP Mobil — APK'nın KENDİ KİMLİĞİ (paket adı · güncelleme adresi · OTA
// sertifikası · gömülü uygulama yapılandırması) — build-apk ve mobil-yayinla ORTAK
// =============================================================================
// Otorite paketin kendisidir: AndroidManifest.xml ikili XML'dir (AXML) ve Android
// kurulumda paket adını `<manifest package=…>` özniteliğinden okur. Metin araması
// (UTF-16 dize havuzunda "com.teks…" geçiyor mu) paket adını AYIRT EDEMEZ: etkinlik
// ve sağlayıcı adları da aynı öneki taşır. Bu yüzden öğe/öznitelik düzeyinde okunur.
// Bağımlılık YOK (aapt/apkanalyzer SDK'ya bağlıydı; CI'da ve saf Node'da yok).
//
// ⚠️ Okunamayan her şey HATA fırlatır (`ApkOlculemedi`) — çağıran ÖLÇÜLEMEDİ = DUR der.
// =============================================================================

import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

import { zipGirdisiOku } from './zip.mjs';

export class ApkOlculemedi extends Error {}

const RES_XML = 0x0003;
const RES_STRING_POOL = 0x0001;
const RES_XML_START_ELEMENT = 0x0102;
const UTF8_BAYRAGI = 0x100;
const YOK = 0xffffffff;

function dizeHavuzu(b, o) {
  const baslikBoyu = b.readUInt16LE(o + 2);
  const sayi = b.readUInt32LE(o + 8);
  const utf8 = (b.readUInt32LE(o + 16) & UTF8_BAYRAGI) !== 0;
  const veriBasi = o + b.readUInt32LE(o + 20);
  const dizeler = [];
  for (let i = 0; i < sayi; i++) {
    let p = veriBasi + b.readUInt32LE(o + baslikBoyu + i * 4);
    if (utf8) {
      // UTF-16 uzunluğu (atlanır) + UTF-8 bayt uzunluğu; her biri 1 ya da 2 bayt.
      p += b[p] & 0x80 ? 2 : 1;
      let n = b[p];
      if (n & 0x80) { n = ((n & 0x7f) << 8) | b[p + 1]; p += 2; } else p += 1;
      dizeler.push(b.toString('utf8', p, p + n));
    } else {
      let n = b.readUInt16LE(p);
      if (n & 0x8000) { n = ((n & 0x7fff) << 16) | b.readUInt16LE(p + 2); p += 4; } else p += 2;
      dizeler.push(b.toString('utf16le', p, p + n * 2));
    }
  }
  return dizeler;
}

/**
 * İkili AndroidManifest.xml → öğeler `[{ ad, oznitelik: {ad: değer} }]` (belge sırası).
 * Dize olmayan tipli değerler (referans, sayı) `@0x…` / ondalık olarak döner.
 */
export function axmlOgeleri(b) {
  if (!Buffer.isBuffer(b) || b.length < 8 || b.readUInt16LE(0) !== RES_XML) {
    throw new ApkOlculemedi('AndroidManifest.xml ikili XML (AXML) değil');
  }
  let dizeler = null;
  const ogeler = [];
  let o = b.readUInt16LE(2);
  while (o + 8 <= b.length) {
    const tur = b.readUInt16LE(o);
    const boy = b.readUInt32LE(o + 4);
    if (boy < 8 || o + boy > b.length) throw new ApkOlculemedi(`AXML parça sınırı bozuk (ofset ${o})`);
    if (tur === RES_STRING_POOL && !dizeler) dizeler = dizeHavuzu(b, o);
    if (tur === RES_XML_START_ELEMENT) {
      if (!dizeler) throw new ApkOlculemedi('AXML dize havuzu öğeden önce gelmedi');
      const ek = o + b.readUInt16LE(o + 2);
      const dize = (i) => (i === YOK ? null : dizeler[i] ?? null);
      const ad = dize(b.readUInt32LE(ek + 4));
      const oznBas = ek + b.readUInt16LE(ek + 8);
      const oznBoy = b.readUInt16LE(ek + 10);
      const oznSayi = b.readUInt16LE(ek + 12);
      const oznitelik = {};
      for (let i = 0; i < oznSayi; i++) {
        const a = oznBas + i * oznBoy;
        const adi = dize(b.readUInt32LE(a + 4));
        const ham = b.readUInt32LE(a + 8);
        const tip = b[a + 15];
        const veri = b.readUInt32LE(a + 16);
        let deger;
        if (ham !== YOK) deger = dize(ham);
        else if (tip === 0x03) deger = dize(veri);
        else if (tip === 0x12) deger = veri ? 'true' : 'false';
        else if (tip === 0x10) deger = String(veri | 0);
        else deger = `@0x${veri.toString(16).padStart(8, '0')}`;
        if (adi) oznitelik[adi] = deger;
      }
      ogeler.push({ ad, oznitelik });
    }
    o += boy;
  }
  if (!ogeler.length) throw new ApkOlculemedi('AndroidManifest.xml öğe taşımıyor');
  return ogeler;
}

/* ------------------------------------------------------------------ *
 * AAB: `base/manifest/AndroidManifest.xml` aapt2 PROTOBUF biçimidir (Resources.proto XmlNode), AXML değil
 * ------------------------------------------------------------------ */

function protoAlanlari(b, bas = 0, son = b.length) {
  const alanlar = [];
  let o = bas;
  const varint = () => {
    let v = 0;
    let carpan = 1;
    for (;;) {
      if (o >= son) throw new ApkOlculemedi('protobuf varint kesik');
      const x = b[o++];
      v += (x & 0x7f) * carpan;
      if (!(x & 0x80)) return v;
      carpan *= 128;
    }
  };
  while (o < son) {
    const anahtar = varint();
    const no = Math.floor(anahtar / 8);
    const tur = anahtar % 8;
    if (tur === 0) alanlar.push({ no, tur, deger: varint() });
    else if (tur === 2) {
      const n = varint();
      if (o + n > son) throw new ApkOlculemedi('protobuf alan uzunluğu taşıyor');
      alanlar.push({ no, tur, bas: o, son: o + n });
      o += n;
    } else if (tur === 5) o += 4;
    else if (tur === 1) o += 8;
    else throw new ApkOlculemedi(`protobuf tel türü ${tur} tanınmıyor`);
  }
  return alanlar;
}

/**
 * Protobuf AndroidManifest (aapt2 `--proto-format`, AAB'deki biçim) → öğeler `[{ ad, oznitelik }]` (belge sırası).
 * Öznitelik değeri derlenmiş öğeden (boolean → 'true'/'false', dize → metni); yoksa ham metin (`value`).
 * Alan numaraları aapt2 Resources.proto: XmlNode{element=1} · XmlElement{name=3, attribute=4, child=5} ·
 * XmlAttribute{name=2, value=3, compiled_item=6} · Item{str=2, prim=7} · Primitive{boolean_value=8}.
 */
export function protoManifestOgeleri(b) {
  const metin = (a) => b.toString('utf8', a.bas, a.son);
  const ogeler = [];
  const derlenmis = (item) => {
    for (const f of protoAlanlari(b, item.bas, item.son)) {
      if (f.no === 7 && f.tur === 2) {
        const bool = protoAlanlari(b, f.bas, f.son).find((p) => p.no === 8 && p.tur === 0);
        if (bool) return bool.deger ? 'true' : 'false';
      }
      if (f.no === 2 && f.tur === 2) {
        const v = protoAlanlari(b, f.bas, f.son).find((p) => p.no === 1 && p.tur === 2);
        if (v) return metin(v);
      }
    }
    return null;
  };
  const dugum = (bas, son, derinlik) => {
    if (derinlik > 64) throw new ApkOlculemedi('protobuf manifest çok derin');
    const el = protoAlanlari(b, bas, son).find((f) => f.no === 1 && f.tur === 2);
    if (!el) return;
    const alanlar = protoAlanlari(b, el.bas, el.son);
    const ad = alanlar.find((f) => f.no === 3 && f.tur === 2);
    const oznitelik = {};
    for (const a of alanlar.filter((f) => f.no === 4 && f.tur === 2)) {
      const ic = protoAlanlari(b, a.bas, a.son);
      const n = ic.find((f) => f.no === 2 && f.tur === 2);
      const v = ic.find((f) => f.no === 3 && f.tur === 2);
      const c = ic.find((f) => f.no === 6 && f.tur === 2);
      if (!n) continue;
      // Derlenmiş öğe öncelikli: Android meta-data'yı oradan okur (boolean `getBoolean`, ham "true" dizesi değil).
      const d = c ? derlenmis(c) : null;
      oznitelik[metin(n)] = d ?? (v ? metin(v) : null);
    }
    ogeler.push({ ad: ad ? metin(ad) : null, oznitelik });
    for (const c of alanlar.filter((f) => f.no === 5 && f.tur === 2)) dugum(c.bas, c.son, derinlik + 1);
  };
  try {
    dugum(0, b.length, 0);
  } catch (e) {
    if (e instanceof ApkOlculemedi) throw e;
    throw new ApkOlculemedi(`protobuf manifest okunamadı: ${e.message}`);
  }
  if (!ogeler.length || ogeler[0].ad !== 'manifest') throw new ApkOlculemedi('protobuf manifest kök öğesi <manifest> değil');
  return ogeler;
}

/** Öğelerden `<meta-data name → value>` haritası (APK ve AAB ortak). */
export function metaHaritasi(ogeler) {
  const meta = {};
  for (const e of ogeler) if (e.ad === 'meta-data' && e.oznitelik.name) meta[e.oznitelik.name] = e.oznitelik.value ?? null;
  return meta;
}

/** PEM'in DER parmak izi (satır sonu/biçim farkı kimlik farkı değildir). */
export function sertifikaParmakIzi(pem) {
  try {
    return new crypto.X509Certificate(String(pem)).fingerprint256;
  } catch {
    return null;
  }
}

const UPD = 'expo.modules.updates.';

/**
 * APK dosyasının kimliği.
 * @returns {{ paket: string, guncellemeAdresi: string|null, sertifikaPem: string|null,
 *             guncellemeAcik: string|null, zincirAcik: string|null, appConfig: object|null, surumAdi: string|null, surumKodu: number|null,
 *             izinler: string[] }}
 * `surumAdi`/`surumKodu` `<manifest android:versionName/versionCode>`dan — yayıncı sürümü ARGÜMANDAN değil buradan alır.
 * `izinler` birleşik manifestteki `<uses-permission android:name>` değerleri (Play'in yasakladığı izin denetimi).
 */
export function apkKimligi(apkYolu) {
  let r;
  try {
    r = zipGirdisiOku(apkYolu, 'AndroidManifest.xml');
  } catch (e) {
    throw new ApkOlculemedi(`AndroidManifest.xml okunamadı: ${e?.message ?? e}`);
  }
  if (r.hata || !r.veri) throw new ApkOlculemedi(`AndroidManifest.xml okunamadı: ${r.hata ?? 'boş'}`);
  const ogeler = axmlOgeleri(r.veri);
  const kok = ogeler[0];
  if (kok.ad !== 'manifest' || !kok.oznitelik.package) {
    throw new ApkOlculemedi('AndroidManifest.xml kök öğesi <manifest package=…> taşımıyor');
  }
  const meta = metaHaritasi(ogeler);

  // expo-constants her derlemede yapılandırmayı `assets/app.config`e gömer; çalışma anında
  // `Constants.expoConfig` odur (APK künyesinin adresi ve görünür etiket buradan okunur).
  let appConfig = null;
  try {
    const c = zipGirdisiOku(apkYolu, 'assets/app.config');
    if (!c.hata && c.veri) appConfig = JSON.parse(c.veri.toString('utf8'));
  } catch {
    appConfig = null;
  }
  return {
    paket: kok.oznitelik.package,
    guncellemeAdresi: meta[`${UPD}EXPO_UPDATE_URL`] ?? null,
    sertifikaPem: meta[`${UPD}CODE_SIGNING_CERTIFICATE`] ?? null,
    guncellemeAcik: meta[`${UPD}ENABLED`] ?? null,
    // K-2: tablet OTA sertifika zincirini yalnız bu meta-data `true` iken okur (plugins/withOtaZinciri.js).
    zincirAcik: meta[`${UPD}CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN`] ?? null,
    appConfig,
    surumAdi: typeof kok.oznitelik.versionName === 'string' ? kok.oznitelik.versionName : null,
    surumKodu: /^\d+$/.test(String(kok.oznitelik.versionCode ?? '')) ? Number(kok.oznitelik.versionCode) : null,
    izinler: ogeler.filter((e) => e.ad === 'uses-permission' && e.oznitelik.name).map((e) => e.oznitelik.name),
  };
}
