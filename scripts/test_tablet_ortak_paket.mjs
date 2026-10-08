#!/usr/bin/env node
// =============================================================================
// BEKÇİ — TEK ORTAK PAKETİN TABLET KİMLİĞİ (O7) · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// Ortak paket = `--musteri`/`TEKSERP_KANAL` YOKKEN derlenen tablet paketi. Kimlik YALNIZ `deploy/dagitim.json`
// `urun.tablet`ten gelir (`mobil/scripts/lib/ortak-kimlik.cjs`); eski kanal (adnansahin) app.json'da bayt-donuk kalır.
//
// NE ÖLÇER:
//   §1 ortak-kimlik.cjs ↔ kayıt: her alan kayıttan bağımsız yeniden türetilmiş değerle eşit; güncelleme adresi
//      grup-nötr Worker takma adı = dagitim.mjs `turet().otaTakmaAd`; kid + yaprak anahtarı/sertifikası kök dizininden
//   §2 app.config.js argümansız (TEKSERP_KANAL yok) → değerlendirilmiş yapılandırma ortak kimlikle farksız;
//      K-14: REQUEST_INSTALL_PACKAGES izinlerde YOK ve blockedPermissions'ta VAR (Play: uygulama kendi APK'sını kuramaz)
//   §3 build-apk.mjs ortak yol (geçici ağaç, ağsız): ortak APK geçer ama mühürde durur · bundle'da ERP
//      adresi · eski kimlikli APK · yabancı sertifika · gorunurEtiket · TEKSERP_KANAL · --api-url · sertifikasız ağaç ·
//      şema dışı kayıt · emekli eski kanal argümanı · kurulum izinli APK/AAB → DUR; `--check` android/ ortak paketle
//      tutarlı mı; K-2: zincir meta-data'sı (APK · AAB protobuf · prebuild) ve gömülü sertifikanın OTA KÖKÜ olması
//      (test anında üretilen atılacak RSA zincirleri); K-14 imza anahtarları: APK = keystore/deneme (test), AAB = keystore/play-yukleme (yükleme) — yoksa
//      android/ denetiminden ÖNCE DUR + keytool komutu; öbür anahtarın ya da keystore/ kökündeki eski mührün kopyası DUR
//   --sonda: §1/§2 yüklemleri enjekte edilmiş bozuk girdilerle KIRMIZIYA düşer (kalıcı negatif sonda)
//
// Üç sonuç: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ.   node scripts/test_tablet_ortak_paket.mjs [--sonda]
// =============================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { KAYIT_REL, KOK, turet } from './lib/dagitim.mjs';

const require = createRequire(import.meta.url);
const ORTAK = require('../mobil/scripts/lib/ortak-kimlik.cjs');
const Z = require('../mobil/scripts/lib/ota-zinciri.cjs');
const BUYUK = require('../mobil/scripts/lib/buyuk-ekran.cjs');
const SONDA = process.argv.includes('--sonda');
const GERCEK_GIT = 'git';
const TEMIZ_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(GIT_|TEKSERP_KANAL$|EXPO_PUBLIC_|EXPO_NO_DOTENV$)/.test(k)));

let basarili = 0;
const hatalar = [];
function ol(ad, kosul, ayrinti = '') {
  if (kosul) { basarili += 1; console.log(`  ✓ ${ad}`); } else { hatalar.push(ad); console.log(`  ✗ ${ad}${ayrinti ? `\n      ${String(ayrinti).replace(/\n/g, '\n      ')}` : ''}`); }
}

/* ---- sahte APK yapıtaşları (test_grup_yayin_tablet.mjs ile aynı biçim) ----
 * OTA sertifikaları test anında üretilen ATILACAK zincirlerdir (ota-zinciri.cjs denemeZinciriUret, openssl; §3 GECICI
 * altında): SERT_KANAL = ortak ağacın OTA kökü · SERT_YABANCI = başka bir OTA kökü · SERT_YAPRAK = kökün yaprağı (CA değil). */
let SERT_KANAL = null;
let SERT_YABANCI = null;
let SERT_YAPRAK = null;
/** latest.yml'e künye: imzalayan anahtar, künyenin kanalı ve `capa` (pakete gömülü çapanın kid'leri) seçilebilir. */
/** Asgari ZIP (APK biçimi) — merkezî dizinli; biri deflate biri stored. */
function zipYaz(yol, girdiler) {
  const yerel = [];
  const merkez = [];
  let ofset = 0;
  for (const { ad, veri, yontem } of girdiler) {
    const adB = Buffer.from(ad, 'utf8');
    const sik = yontem === 8 ? zlib.deflateRawSync(veri) : veri;
    const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(veri) : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(yontem, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(sik.length, 18); lh.writeUInt32LE(veri.length, 22); lh.writeUInt16LE(adB.length, 26);
    yerel.push(lh, adB, sik);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(yontem, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(sik.length, 20); ch.writeUInt32LE(veri.length, 24); ch.writeUInt16LE(adB.length, 28);
    ch.writeUInt32LE(ofset, 42);
    merkez.push(ch, adB);
    ofset += 30 + adB.length + sik.length;
  }
  const cd = Buffer.concat(merkez);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(girdiler.length, 8); eocd.writeUInt16LE(girdiler.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(ofset, 16);
  fs.writeFileSync(yol, Buffer.concat([...yerel, cd, eocd]));
}
/**
 * Asgari İKİLİ AndroidManifest (AXML, UTF-16 dize havuzu): `<manifest package>` + `<meta-data>`.
 * Android'in kurulumda okuduğu biçim — paket adı öznitelikten, metin aramasından değil.
 */
function axmlYaz({ paket, meta = {}, surumAdi = null, surumKodu = null, izinler = [] }) {
  const NS = 'http://schemas.android.com/apk/res/android';
  const YOK = 0xffffffff;
  const dizeler = [];
  const no = (x) => {
    let i = dizeler.indexOf(x);
    if (i < 0) i = dizeler.push(x) - 1;
    return i;
  };
  const ogeler = [{ ad: 'manifest', oz: paket == null ? [] : [{ ns: null, ad: 'package', deger: paket }] }];
  if (surumKodu != null) ogeler[0].oz.push({ ns: NS, ad: 'versionCode', deger: String(surumKodu) });
  if (surumAdi != null) ogeler[0].oz.push({ ns: NS, ad: 'versionName', deger: surumAdi });
  for (const iz of izinler) ogeler.push({ ad: 'uses-permission', oz: [{ ns: NS, ad: 'name', deger: iz }] });
  for (const [n, v] of Object.entries(meta)) ogeler.push({ ad: 'meta-data', oz: [{ ns: NS, ad: 'name', deger: n }, { ns: NS, ad: 'value', deger: v }] });
  for (const e of ogeler) { no(e.ad); for (const a of e.oz) { if (a.ns) no(a.ns); no(a.ad); no(a.deger); } }
  const veriler = dizeler.map((x) => { const u = Buffer.alloc(2); u.writeUInt16LE(x.length); return Buffer.concat([u, Buffer.from(x, 'utf16le'), Buffer.alloc(2)]); });
  let dv = Buffer.concat(veriler);
  if (dv.length % 4) dv = Buffer.concat([dv, Buffer.alloc(4 - (dv.length % 4))]);
  const havuz = Buffer.alloc(28 + 4 * dizeler.length);
  havuz.writeUInt16LE(0x0001, 0); havuz.writeUInt16LE(28, 2); havuz.writeUInt32LE(havuz.length + dv.length, 4);
  havuz.writeUInt32LE(dizeler.length, 8); havuz.writeUInt32LE(28 + 4 * dizeler.length, 20);
  let ofs = 0;
  veriler.forEach((v, i) => { havuz.writeUInt32LE(ofs, 28 + 4 * i); ofs += v.length; });
  const parcalar = [havuz, dv];
  for (const e of ogeler) {
    const b = Buffer.alloc(36 + 20 * e.oz.length);
    b.writeUInt16LE(0x0102, 0); b.writeUInt16LE(16, 2); b.writeUInt32LE(b.length, 4); b.writeUInt32LE(1, 8); b.writeUInt32LE(YOK, 12);
    b.writeUInt32LE(YOK, 16); b.writeUInt32LE(no(e.ad), 20); b.writeUInt16LE(20, 24); b.writeUInt16LE(20, 26); b.writeUInt16LE(e.oz.length, 28);
    e.oz.forEach((a, i) => {
      const k = 36 + 20 * i;
      b.writeUInt32LE(a.ns ? no(a.ns) : YOK, k); b.writeUInt32LE(no(a.ad), k + 4); b.writeUInt32LE(no(a.deger), k + 8);
      b.writeUInt16LE(8, k + 12); b[k + 15] = 0x03; b.writeUInt32LE(no(a.deger), k + 16);
    });
    parcalar.push(b);
  }
  const govde = Buffer.concat(parcalar);
  const bas = Buffer.alloc(8);
  bas.writeUInt16LE(0x0003, 0); bas.writeUInt16LE(8, 2); bas.writeUInt32LE(8 + govde.length, 4);
  return Buffer.concat([bas, govde]);
}

/* ------------------------------------------------------------------ *
 * §1/§2 saf yüklemler (sondalar enjekte edilmiş girdiyle çağırır)
 * ------------------------------------------------------------------ */

/** Kimlik, kayıttan BAĞIMSIZ yeniden türetimle eşit mi? Hata satırları döner. */
function kimlikFarki(kayit, k) {
  const t = kayit.urun.tablet;
  const f = [];
  const e = (ad, gercek, beklenen) => { if (gercek !== beklenen) f.push(`${ad}: "${gercek}" ≠ "${beklenen}"`); };
  e('androidPaket', k.androidPaket, t.androidPaket);
  e('gorunenAd', k.gorunenAd, t.gorunenAd);
  e('runtimeVersion', k.runtimeVersion, t.runtimeVersion);
  e('otaSertifika', k.otaSertifika, t.otaSertifika);
  const ad = /^keystore\/ota-certs-([a-z0-9-]+)\/certificate\.pem$/.exec(t.otaSertifika)?.[1];
  e('anahtarKimligi', k.anahtarKimligi, ad);
  // Yaprak depoda DEĞİL (yıllık dönem töreninin istemci dizini): kimlik yaprak yolu taşımaz.
  for (const a of ['otaAnahtar', 'otaYaprak']) if (a in k) f.push(`${a} kimlikte var ("${k[a]}") — depoda varsayılan yaprak yolu olmaz`);
  e('guncellemeUrl (kayıt şablonu)', k.guncellemeUrl, `${kayit.indirmeKoku}ota/${t.runtimeVersion}/manifest`);
  e('guncellemeUrl (dagitim.mjs türetimi)', k.guncellemeUrl, turet(kayit).otaTakmaAd);
  // Grup-nötr: adres hiçbir grup kodunu yol öneki olarak taşımaz.
  for (const g of kayit.gruplar) if (k.guncellemeUrl.startsWith(`${kayit.indirmeKoku}${g.kod}/`)) f.push(`güncelleme adresi grup "${g.kod}" taşıyor`);
  return f;
}

const YASAK_IZIN = 'android.permission.REQUEST_INSTALL_PACKAGES';
/** K-14: değerlendirilmiş yapılandırmada kurulum izni İSTENMEZ ve birleşik manifestten açıkça SİLİNİR (kütüphane eklese de). */
function izinFarki(c) {
  const f = [];
  const kisa = (x) => String(x).replace(/^android\.permission\./, '');
  if ((c.android?.permissions ?? []).some((x) => kisa(x) === kisa(YASAK_IZIN))) f.push(`android.permissions ${YASAK_IZIN} istiyor`);
  if (!(c.android?.blockedPermissions ?? []).includes(YASAK_IZIN)) f.push(`android.blockedPermissions ${YASAK_IZIN} taşımıyor`);
  return f;
}

function degerlendirilmisYapilandirma() {
  const r = spawnSync(process.execPath, ['-e',
    "const c=require('./app.config.js')({config:require('./app.json').expo});process.stdout.write(JSON.stringify(c))"],
  { cwd: path.join(KOK, 'mobil'), encoding: 'utf8', env: TEMIZ_ENV });
  if (r.status !== 0) throw new Error(`app.config.js değerlendirilemedi: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

const kayit = JSON.parse(fs.readFileSync(path.join(KOK, KAYIT_REL), 'utf8'));
const kimlik = ORTAK.ortakKimlik(kayit);
const cfg = degerlendirilmisYapilandirma();

console.log('test_tablet_ortak_paket — tek ortak paketin tablet kimliği (O7)\n');

if (SONDA) {
  console.log('--sonda: kalıcı sondalar (bellekteki bozuk girdilere karşı)\n');
  const kopya = (x) => JSON.parse(JSON.stringify(x));
  ol('P1 pozitif: gerçek kimlik kayıtla farksız', kimlikFarki(kayit, kimlik).length === 0);
  ol('P2 pozitif: gerçek yapılandırma ortak kimlikle farksız', ORTAK.ortakYapilandirmaFarki(cfg).length === 0);
  ol('N1 güncelleme adresi gruba gömülü → kırmızı', kimlikFarki(kayit, { ...kimlik, guncellemeUrl: `${kayit.indirmeKoku}test/mobil/ota/55.0/manifest` }).length > 0);
  ol('N2 runtimeVersion kayıttan sapmış → kırmızı', kimlikFarki(kayit, { ...kimlik, runtimeVersion: '54.2' }).length > 0);
  ol('N3 kid sertifika dizininden türemiyor → kırmızı', kimlikFarki(kayit, { ...kimlik, anahtarKimligi: 'main' }).length > 0);
  ol('N3b kimlik depoda varsayılan yaprak anahtarı yolu taşıyor → kırmızı', kimlikFarki(kayit, { ...kimlik, otaAnahtar: 'keystore/ota-keys-ortak/private-key.pem' }).length > 0);
  ol('N3c kimlik depoda varsayılan yaprak sertifikası yolu taşıyor → kırmızı', kimlikFarki(kayit, { ...kimlik, otaYaprak: 'keystore/ota-keys-ortak/certificate.pem' }).length > 0);
  ol('N4 paket adı eski kanalın → kırmızı', kimlikFarki(kayit, { ...kimlik, androidPaket: 'com.teks.erp.mobil' }).length > 0);
  const gruplu = kopya(kayit); gruplu.gruplar.push({ kod: 'ota', ad: 'x', terfiKaynagi: 'genel' });
  let n5 = false; try { n5 = kimlikFarki(gruplu, kimlik).length > 0; } catch { n5 = true; }
  ol('N5 grup kodu takma adla (ota) çakışırsa kayıt reddedilir → kırmızı', n5);
  for (const [ad, mut] of [
    ['name eski', (c) => { c.name = 'TeksERP Eski'; }],
    ['paket eski', (c) => { c.android.package = 'com.teks.erp.mobil'; }],
    ['güncelleme adresi eski kanal', (c) => { c.updates.url = 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest'; }],
    ['runtimeVersion eski', (c) => { c.runtimeVersion = '54.2'; }],
    ['kid eski', (c) => { c.updates.codeSigningMetadata.keyid = 'main'; }],
    ['sertifika eski', (c) => { c.updates.codeSigningCertificate = './keystore/ota-certs/certificate.pem'; }],
    ['görünür etiket sızmış', (c) => { c.extra = { ...(c.extra ?? {}), gorunurEtiket: 'TEST' }; }],
    ['zincir eklentisi (withOtaZinciri) yok', (c) => { c.plugins = (c.plugins ?? []).filter((x) => (Array.isArray(x) ? x[0] : x) !== ORTAK.ZINCIR_EKLENTISI); }],
  ]) {
    const c = kopya(cfg); mut(c);
    ol(`N6 yapılandırma: ${ad} → kırmızı`, ORTAK.ortakYapilandirmaFarki(c).length > 0);
  }
  const bozuk = kopya(kayit); bozuk.urun.tablet.otaSertifika = 'keystore/ota-certs/certificate.pem';
  let at = false; try { ORTAK.ortakKimlik(bozuk); } catch { at = true; }
  ol('N7 sertifika dizini biçimsiz → ortakKimlik() atar (yerleşiğe sapma yok)', at);
  const http = kopya(kayit); http.indirmeKoku = 'http://indir.etkiliyazilim.com/';
  at = false; try { ORTAK.ortakKimlik(http); } catch { at = true; }
  ol('N8 indirmeKoku https değil → ortakKimlik() atar', at);
  const eksik = kopya(kayit); delete eksik.urun.tablet.gorunenAd;
  at = false; try { ORTAK.ortakKimlik(eksik); } catch { at = true; }
  ol('N9 urun.tablet alanı eksik → ortakKimlik() atar', at);
  at = false;
  process.env.EXPO_PUBLIC_UPDATE_URL = 'https://x.example/ota/55.0/manifest';
  try { ORTAK.ortakYapilandirmasi({ extra: {} }); } catch { at = true; }
  delete process.env.EXPO_PUBLIC_UPDATE_URL;
  ol('N10 EXPO_PUBLIC_UPDATE_URL ile ezme → atar', at);
  ol('P3 pozitif: gerçek yapılandırmada kurulum izni yok, blokta var', izinFarki(cfg).length === 0, izinFarki(cfg).join('\n'));
  const geri = kopya(cfg); geri.android.permissions = [...(geri.android.permissions ?? []), 'REQUEST_INSTALL_PACKAGES'];
  ol('N11 REQUEST_INSTALL_PACKAGES izinlere geri eklendi → kırmızı', izinFarki(geri).length > 0);
  const blok = kopya(cfg); blok.android.blockedPermissions = (blok.android.blockedPermissions ?? []).filter((x) => x !== YASAK_IZIN);
  ol('N12 blockedPermissions\'tan kalktı → kırmızı', izinFarki(blok).length > 0);
  bitir();
}

console.log('§1 — ortak-kimlik.cjs ↔ deploy/dagitim.json');
{
  const f = kimlikFarki(kayit, kimlik);
  ol('1a kimlik kayıttan türer (paket · ad · rv · OTA kökü · kid · adres; yaprak yolu YOK)', f.length === 0, f.join('\n'));
  ol('1b güncelleme adresi grup-nötr Worker takma adı', kimlik.guncellemeUrl === `${kayit.indirmeKoku}ota/${kayit.urun.tablet.runtimeVersion}/manifest`, kimlik.guncellemeUrl);
  const yol = ORTAK.otaTorenYonergesi(kimlik).join('\n');
  ol('1c OTA tören yönergesi tören araçlarından (kök kok-uret · APK kopyası kimlikten · yaprak dönem --istemci · yayın --ota-anahtar · elle openssl/repo-içi yaprak YOK)',
    /ota-zinciri\.mjs kok-uret --dizin=\$HOME\/\.tekserp\/satici-uretim\/anahtarlar/.test(yol) &&
      yol.includes(`cp $HOME/.tekserp/satici-uretim/anahtarlar/ota-kok.pem mobil/${kimlik.otaSertifika}`) &&
      /uretim-toren\.mjs donem --istemci/.test(yol) && /URETIM-SATICI-TOREN\.md §9/.test(yol) &&
      /--ota-anahtar=\$HOME\/\.tekserp\/satici-uretim\/donemler\/<damga>\/istemci\/ota-yaprak\/private-key\.pem/.test(yol) &&
      !/openssl|ota-keys-|codesigning:generate|pass:|chmod/.test(yol), yol);
}
console.log('\n§2 — app.config.js argümansız = ortak kimlik');
{
  const f = ORTAK.ortakYapilandirmaFarki(cfg);
  ol('2a değerlendirilmiş yapılandırma ortak kimlikle farksız', f.length === 0, f.join('\n'));
  ol('2b ERP adresi yapılandırmaya girmez (extra.apiUrl/EXPO_PUBLIC_API_URL yok)', !/\b(apiUrl|api_url|EXPO_PUBLIC_API_URL)\b/i.test(JSON.stringify(cfg.extra ?? {})), JSON.stringify(cfg.extra));
  const iz = izinFarki(cfg);
  ol('2c K-14: REQUEST_INSTALL_PACKAGES izinlerde yok, blockedPermissions\'ta var', iz.length === 0, iz.join('\n'));
}

/* ------------------------------------------------------------------ *
 * §3 build-apk.mjs ortak yolu — geçici ağaç
 * ------------------------------------------------------------------ */
console.log('\n§3 — build-apk.mjs ortak yol (geçici ağaç, ağsız)');
const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-ortak-'));
process.on('exit', () => fs.rmSync(GECICI, { recursive: true, force: true }));
try {
  const zk = Z.denemeZinciriUret(path.join(GECICI, 'zincir-kanal'));
  SERT_KANAL = zk.kokPem;
  SERT_YAPRAK = zk.yaprakPem;
  SERT_YABANCI = Z.denemeZinciriUret(path.join(GECICI, 'zincir-yabanci')).kokPem;
} catch (e) {
  console.log(`ÖLÇÜLEMEDİ: deneme OTA zinciri üretilemedi (openssl gerekli): ${e.message}`);
  process.exit(2);
}
let sayac = 0;
const git = (cwd, ...a) => spawnSync(GERCEK_GIT, ['-c', 'user.email=bekci@test', '-c', 'user.name=bekci', ...a], { cwd, env: TEMIZ_ENV, encoding: 'utf8' });

/** Sahte anahtar dosyaları (rastgele bayt — gerçek anahtar ÜRETİLMEZ): {dizin: {storeFile, bayt}} + kök dosyaları. */
function anahtarYaz(agac, anahtarlar = {}, kok = {}) {
  for (const [dizin, { storeFile, bayt }] of Object.entries(anahtarlar)) {
    const d = path.join(agac, 'mobil/keystore', dizin);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'keystore.properties'), `storeFile=${storeFile}\nstorePassword=x\nkeyAlias=x\nkeyPassword=x\n`);
    if (bayt && !storeFile.includes('/')) fs.writeFileSync(path.join(d, storeFile), bayt);
  }
  for (const [ad, bayt] of Object.entries(kok)) fs.writeFileSync(path.join(agac, 'mobil/keystore', ad), bayt);
}

function agacKur({ sert = SERT_KANAL, kayitDegistir = null, android = null } = {}) {
  sayac += 1;
  const agac = path.join(GECICI, `agac-${sayac}`);
  fs.cpSync(path.join(KOK, 'scripts/lib'), path.join(agac, 'scripts/lib'), { recursive: true });
  fs.cpSync(path.join(KOK, 'mobil/scripts'), path.join(agac, 'mobil/scripts'), { recursive: true });
  for (const rel of ['mobil/app.json', 'mobil/app.config.js', 'mobil/package.json', 'deploy/kanallar.json', 'surum-notlari.json']) {
    fs.mkdirSync(path.dirname(path.join(agac, rel)), { recursive: true });
    fs.copyFileSync(path.join(KOK, rel), path.join(agac, rel));
  }
  fs.mkdirSync(path.join(agac, 'deploy'), { recursive: true });
  const k = JSON.parse(fs.readFileSync(path.join(KOK, KAYIT_REL), 'utf8'));
  if (kayitDegistir) kayitDegistir(k);
  fs.writeFileSync(path.join(agac, KAYIT_REL), `${JSON.stringify(k, null, 2)}\n`);
  fs.mkdirSync(path.join(agac, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(agac, 'scripts/check-surum-notlari.mjs'), 'process.exit(0);\n');
  if (sert) {
    fs.mkdirSync(path.join(agac, 'mobil/keystore/ota-certs-ortak'), { recursive: true });
    fs.writeFileSync(path.join(agac, 'mobil/keystore/ota-certs-ortak/certificate.pem'), sert);
  }
  if (android) android(path.join(agac, 'mobil/android'));
  git(agac, 'init', '-q'); git(agac, 'add', '-A'); git(agac, 'commit', '-q', '-m', 'taban');
  return agac;
}

const ORTAK_CFG = { name: kimlik.gorunenAd, android: { package: kimlik.androidPaket }, updates: { url: kimlik.guncellemeUrl } };
function apk(agac, { paket = kimlik.androidPaket, url = kimlik.guncellemeUrl, bundle = 'hermes\u0000/api/auth/login\u0000son', sertPem = SERT_KANAL, appConfig = ORTAK_CFG, izinler = [], zincir = 'true' } = {}) {
  sayac += 1;
  const y = path.join(agac, `sahte-${sayac}.apk`);
  const meta = { 'expo.modules.updates.ENABLED': 'true', 'expo.modules.updates.EXPO_UPDATE_URL': url };
  if (sertPem) meta['expo.modules.updates.CODE_SIGNING_CERTIFICATE'] = sertPem;
  if (zincir != null) meta[Z.ZINCIR_META] = zincir;
  const g = [
    { ad: 'AndroidManifest.xml', veri: axmlYaz({ paket, meta, surumAdi: '1.0.0', surumKodu: 1, izinler }), yontem: 8 },
    { ad: 'assets/index.android.bundle', veri: Buffer.from(bundle, 'latin1'), yontem: 0 },
  ];
  if (appConfig) g.push({ ad: 'assets/app.config', veri: Buffer.from(JSON.stringify(appConfig)), yontem: 8 });
  zipYaz(y, g);
  return y;
}
function buildApk(agac, args, ortamEk = {}) {
  const r = spawnSync(process.execPath, [path.join(agac, 'mobil/scripts/build-apk.mjs'), ...args], {
    cwd: path.join(agac, 'mobil'), encoding: 'utf8', timeout: 120_000, env: { ...TEMIZ_ENV, ...ortamEk },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const dogrula = (agac, y, ortamEk) => buildApk(agac, [`--verify-only=${y}`], ortamEk);

{
  const a = agacKur(); const r = dogrula(a, apk(a));
  ol('3a ortak kimlikli APK → kimlik + bundle geçer, İMZADA durur (test anahtarı ağaçta yok; eski mühre düşmez)',
    r.kod !== 0 && /RELEASE APK \(ORTAK PAKET\)/.test(r.cikti) && /✔ APK ortak paketin kimliğini taşıyor/.test(r.cikti) &&
      /✔ Bundle'da ERP adresi yok/.test(r.cikti) && /TEST imza anahtarı .*YOK/.test(r.cikti) && /keystore\/deneme\/keystore\.properties/.test(r.cikti), r.cikti.slice(-700));
}
{
  const a = agacKur(); const y = apk(a, { bundle: 'hermes\u0000http://192.168.1.250:4000/api\u0000son' }); const r = dogrula(a, y);
  ol("3b bundle'da ERP adresi → DUR, APK .DOGRULANMADI.apk'ya taşınır",
    r.kod !== 0 && /BUNDLE'INDA ERP ADRESİ VAR/.test(r.cikti) && !fs.existsSync(y) && fs.existsSync(y.replace(/\.apk$/, '.DOGRULANMADI.apk')), r.cikti.slice(-500));
}
{
  const a = agacKur(); const r = dogrula(a, apk(a, { paket: 'com.teks.erp.mobil', url: 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest',
    appConfig: { name: 'TeksERP', android: { package: 'com.teks.erp.mobil' }, updates: { url: 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest' } } }));
  ol('3c eski kanal kimlikli APK → KİMLİĞİNİ TAŞIMIYOR (eski kimliğe sessizce düşmez)',
    r.kod !== 0 && /APK ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR/.test(r.cikti) && /paket adı "com\.teks\.erp\.mobil"/.test(r.cikti), r.cikti.slice(-600));
}
{
  const a = agacKur(); const r = dogrula(a, apk(a, { sertPem: SERT_YABANCI }));
  ol('3d yabancı OTA sertifikası gömülü APK → DUR', r.kod !== 0 && /gömülü OTA sertifikası ortak paketinki değil/.test(r.cikti), r.cikti.slice(-500));
}
{
  const a = agacKur(); const r = dogrula(a, apk(a, { appConfig: { ...ORTAK_CFG, extra: { gorunurEtiket: 'TEST' } } }));
  ol('3e assets/app.config extra.gorunurEtiket → DUR', r.kod !== 0 && /assets\/app\.config extra\.gorunurEtiket/.test(r.cikti), r.cikti.slice(-500));
}
{
  const a = agacKur(); const r = dogrula(a, apk(a), { TEKSERP_KANAL: 'adnansahin' });
  ol('3f ortamda TEKSERP_KANAL → EMEKLİ ESKİ KANAL ORTAMI', r.kod !== 0 && /EMEKLİ ESKİ KANAL ORTAMI/.test(r.cikti), r.cikti.slice(-400));
}
{
  const a = agacKur(); const r = buildApk(a, ['--api-url=http://192.168.1.250:4000/api', `--verify-only=${apk(a)}`]);
  ol('3g --api-url → ORTAK PAKET ERP ADRESİ GÖMMEZ', r.kod !== 0 && /ORTAK PAKET ERP ADRESİ GÖMMEZ/.test(r.cikti), r.cikti.slice(-400));
}
{
  const a = agacKur({ sert: null }); const r = dogrula(a, apk(a));
  ol('3h sertifikasız ağaç → ORTAK OTA SERTİFİKASI YOK + tören yönergesi (kok-uret · dönem --istemci · elle openssl yok)',
    r.kod !== 0 && /ORTAK OTA SERTİFİKASI YOK/.test(r.cikti) && /ota-zinciri\.mjs kok-uret/.test(r.cikti) &&
      /uretim-toren\.mjs donem --istemci/.test(r.cikti) && !/openssl genpkey|ota-keys-/.test(r.cikti), r.cikti.slice(-500));
}
{
  const a = agacKur(); const r = dogrula(a, apk(a, { zincir: null }));
  ol('3p K-2: zincir meta-data\'sı yok APK → DUR (tablet certificate_chain\'i okumaz)', r.kod !== 0 && /KİMLİĞİNİ TAŞIMIYOR/.test(r.cikti) &&
    /CODE_SIGNING_INCLUDE_MANIFEST_RESPONSE_CERTIFICATE_CHAIN "yok"/.test(r.cikti), r.cikti.slice(-600));
  const r2 = dogrula(a, apk(a, { zincir: 'false' }));
  ol('3p2 K-2: zincir meta-data\'sı false APK → DUR', r2.kod !== 0 && /CERTIFICATE_CHAIN "false"/.test(r2.cikti), r2.cikti.slice(-600));
}
{
  const a = agacKur({ sert: SERT_YAPRAK }); const r = dogrula(a, apk(a, { sertPem: SERT_YAPRAK }));
  ol('3q K-2: ağacın OTA sertifikası kök değil (yaprak: CA değil, EKU\'lu) → OTA KÖKÜ DEĞİL, APK\'ya bakılmadan DUR',
    r.kod !== 0 && /OTA SERTİFİKASI OTA KÖKÜ DEĞİL/.test(r.cikti) && /CA DEĞİL/.test(r.cikti) && /EKU taşıyor/.test(r.cikti), r.cikti.slice(-600));
}
{
  const a = agacKur({ kayitDegistir: (k) => { k.urun.tablet.musteriAdi = 'x'; } }); const r = dogrula(a, apk(a));
  ol('3i dagitim.json şema dışı anahtar → DAĞITIM KAYDI GEÇERSİZ', r.kod !== 0 && /DAĞITIM KAYDI GEÇERSİZ/.test(r.cikti), r.cikti.slice(-500));
}
for (const arg of ['--musteri=adnansahin', '--terfi-atla=x', '--yoklama-yok']) {
  const a = agacKur(); const r = buildApk(a, [arg, `--verify-only=${apk(a)}`]);
  ol(`3j ${arg.split('=')[0]} → EMEKLİ ESKİ KANAL ARGÜMANI (hiçbir şey yapılmadan)`,
    r.kod !== 0 && /EMEKLİ ESKİ KANAL ARGÜMANI/.test(r.cikti) && !/RELEASE APK/.test(r.cikti), r.cikti.slice(-400));
}
{
  const a = agacKur(); const y = apk(a, { izinler: [YASAK_IZIN] }); const r = dogrula(a, y);
  ol('3k K-14: REQUEST_INSTALL_PACKAGES izinli APK → DUR (kimlik kapısı)', r.kod !== 0 && /REQUEST_INSTALL_PACKAGES izni var/.test(r.cikti) && /KİMLİĞİNİ TAŞIMIYOR/.test(r.cikti), r.cikti.slice(-600));
}
{
  const a = agacKur(); const r = buildApk(a, ['--aab']);
  ol('3l K-14: --aab yükleme anahtarı yok → android/ denetiminden ÖNCE DUR + yer tutucu yol + keytool (anahtar üretmez)',
    r.kod !== 0 && /RELEASE AAB \(ORTAK PAKET\)/.test(r.cikti) && /Google Play YÜKLEME anahtarı.*YOK/.test(r.cikti) &&
      /keystore\/play-yukleme\/keystore\.properties/.test(r.cikti) && /keytool -genkeypair/.test(r.cikti) && !/android\/ native projesi yok/.test(r.cikti) &&
      !fs.existsSync(path.join(a, 'mobil/keystore/play-yukleme')), r.cikti.slice(-700));
  const b = agacKur(); const r2 = buildApk(b, []);
  ol('3m K-14: build:apk test anahtarı yok → android/ denetiminden ÖNCE DUR + keystore/deneme keytool komutu',
    r2.kod !== 0 && /TEST imza anahtarı.*YOK/.test(r2.cikti) && /keytool -genkeypair[^\n]*keystore\/deneme\//.test(r2.cikti) && !/android\/ native projesi yok/.test(r2.cikti), r2.cikti.slice(-700));
}
{
  const eski = crypto.randomBytes(64);
  const a = agacKur(); anahtarYaz(a, { 'play-yukleme': { storeFile: '../tekserp-release.keystore' } }, { 'tekserp-release.keystore': eski });
  const r = buildApk(a, ['--aab']);
  ol('3n K-14: yükleme anahtarı keystore/ köküne (eski mühür) işaret ediyor → GEÇERSİZ', r.kod !== 0 && /YÜKLEME anahtarı.*GEÇERSİZ/.test(r.cikti) && /kendi dizininde değil/.test(r.cikti), r.cikti.slice(-500));
  const b = agacKur(); anahtarYaz(b, { 'play-yukleme': { storeFile: 'y.keystore', bayt: eski } }, { 'tekserp-release.keystore': eski });
  const r2 = buildApk(b, ['--aab']);
  ol('3n2 K-14: yükleme anahtarı eski kanal mührünün bayt-kopyası → GEÇERSİZ', r2.kod !== 0 && /eski kanal mührü/.test(r2.cikti), r2.cikti.slice(-500));
  const ayni = crypto.randomBytes(64);
  const c = agacKur(); anahtarYaz(c, { 'play-yukleme': { storeFile: 'y.keystore', bayt: ayni }, deneme: { storeFile: 'd.keystore', bayt: ayni } });
  const r3 = buildApk(c, ['--aab']);
  ol('3n3 K-14: AAB test anahtarına düşmez (yükleme = deneme kopyası) → GEÇERSİZ', r3.kod !== 0 && /keystore\/play-yukleme anahtarı keystore\/deneme anahtarının KOPYASI/.test(r3.cikti), r3.cikti.slice(-500));
  const r4 = buildApk(c, []);
  ol('3n4 K-14: test APK da yükleme anahtarının kopyasıyla DUR', r4.kod !== 0 && /keystore\/deneme anahtarı keystore\/play-yukleme anahtarının KOPYASI/.test(r4.cikti), r4.cikti.slice(-500));
}
/* Asgari aapt2 protobuf AndroidManifest (Resources.proto): XmlNode{1 element} · XmlElement{3 name, 4 attribute, 5 child} ·
 * XmlAttribute{1 namespace_uri, 2 name, 3 value, 6 compiled_item} · Item{2 str{1 value}, 7 prim{8 boolean_value}}. */
const pbVarint = (n) => { const o = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 0x80; o.push(x); } while (n); return Buffer.from(o); };
const pbAlan = (no, veri) => { const v = Buffer.isBuffer(veri) ? veri : Buffer.from(String(veri), 'utf8'); return Buffer.concat([pbVarint(no * 8 + 2), pbVarint(v.length), v]); };
const pbBool = (b) => pbAlan(7, Buffer.concat([pbVarint(8 * 8), pbVarint(b ? 1 : 0)]));
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const pbOz = (ad, deger, { ns = ANDROID_NS, bool = null } = {}) => pbAlan(4, Buffer.concat([...(ns ? [pbAlan(1, ns)] : []), pbAlan(2, ad), pbAlan(3, deger), ...(bool == null ? [] : [pbAlan(6, pbBool(bool))])]));
const pbOge = (ad, ozler = [], cocuklar = []) => pbAlan(1, Buffer.concat([pbAlan(3, ad), ...ozler, ...cocuklar.map((c) => pbAlan(5, c))]));
function protoManifest({ paket, izinler = [], meta = {}, hedefSdk = '36', yonOzelligi = 'true', cleartext = 'false', hizmetler = [], nscOz = true }) {
  const izin = ['android.permission.INTERNET', ...izinler].map((x) => pbOge('uses-permission', [pbOz('name', x)]));
  const metaOge = Object.entries(meta).map(([n, v]) => pbOge('meta-data', [pbOz('name', n),
    pbOz('value', v, { bool: v === 'true' || v === 'false' ? v === 'true' : null })]));
  const sdk = pbOge('uses-sdk', [pbOz('minSdkVersion', '26'), pbOz('targetSdkVersion', hedefSdk)]);
  const ozellik = yonOzelligi == null ? [] : [pbOge('property', [pbOz('name', BUYUK.YON_OZELLIGI), pbOz('value', yonOzelligi, { bool: yonOzelligi === 'true' })])];
  const uygOz = [...(cleartext == null ? [] : [pbOz('usesCleartextTraffic', cleartext, { bool: cleartext === 'true' })]),
    ...(nscOz ? [pbOz('networkSecurityConfig', '@xml/network_security_config')] : [])];
  const hizmet = hizmetler.map((h) => pbOge('service', [pbOz('name', h)]));
  return pbOge('manifest', [pbOz('package', paket, { ns: null })], [sdk, ...izin, pbOge('application', uygOz, [...metaOge, ...ozellik, ...hizmet])]);
}
/** Ağ güvenlik yapılandırması (proto XML): base-config{cleartextTrafficPermitted} > trust-anchors > certificates{src}. */
function protoNsc({ cleartext = 'false', capalar = ['system'], alan = false } = {}) {
  const sertler = capalar.map((c) => pbOge('certificates', [pbOz('src', c, { ns: null })]));
  const taban = pbOge('base-config', [pbOz('cleartextTrafficPermitted', cleartext, { ns: null, bool: cleartext === 'true' })], [pbOge('trust-anchors', [], sertler)]);
  const ozel = alan ? [pbOge('domain-config', [pbOz('cleartextTrafficPermitted', 'true', { ns: null, bool: true })])] : [];
  return pbOge('network-security-config', [], [taban, ...ozel]);
}
/** Sahte AAB: base/manifest gerçek protobuf AndroidManifest (doğrulayıcı meta-data'yı öğe düzeyinde çözer). */
function aab(agac, { izinler = [], paket = kimlik.androidPaket, zincir = 'true', sertPem = SERT_KANAL, hedefSdk = '36', yonOzelligi = 'true', cleartext = 'false', hizmetler = [], nscOz = true, nsc = {} } = {}) {
  sayac += 1;
  const y = path.join(agac, `sahte-${sayac}.aab`);
  const meta = { 'expo.modules.updates.ENABLED': 'true', 'expo.modules.updates.EXPO_UPDATE_URL': kimlik.guncellemeUrl };
  if (sertPem) meta['expo.modules.updates.CODE_SIGNING_CERTIFICATE'] = sertPem;
  if (zincir != null) meta[Z.ZINCIR_META] = zincir;
  zipYaz(y, [
    { ad: 'base/manifest/AndroidManifest.xml', veri: protoManifest({ paket, izinler, meta, hedefSdk, yonOzelligi, cleartext, hizmetler, nscOz }), yontem: 8 },
    ...(nsc ? [{ ad: 'base/res/xml/network_security_config.xml', veri: protoNsc(nsc), yontem: 8 }] : []),
    { ad: 'base/assets/index.android.bundle', veri: Buffer.from('hermes\u0000/api/auth/login\u0000son', 'latin1'), yontem: 0 },
    { ad: 'base/assets/app.config', veri: Buffer.from(JSON.stringify(ORTAK_CFG)), yontem: 8 },
  ]);
  return y;
}
{
  const a = agacKur(); const r = buildApk(a, ['--aab', `--verify-only=${aab(a)}`]);
  ol('3o K-14: ortak kimlikli AAB → kimlik geçer, İMZADA durur (yükleme anahtarı yok)',
    r.kod !== 0 && /✔ AAB ortak paketin kimliğini taşıyor/.test(r.cikti) && /Google Play YÜKLEME anahtarı.*YOK/.test(r.cikti), r.cikti.slice(-700));
  const y = aab(a, { izinler: [YASAK_IZIN] }); const r2 = buildApk(a, ['--aab', `--verify-only=${y}`]);
  ol('3o2 K-14: REQUEST_INSTALL_PACKAGES izinli AAB → DUR, .DOGRULANMADI.aab', r2.kod !== 0 && /REQUEST_INSTALL_PACKAGES izni var/.test(r2.cikti) &&
    fs.existsSync(y.replace(/\.aab$/, '.DOGRULANMADI.aab')), r2.cikti.slice(-600));
  const r3 = buildApk(a, ['--aab', `--verify-only=${aab(a, { paket: 'com.teks.erp.mobil' })}`]);
  ol('3o3 eski kanal paket adlı AAB → DUR', r3.kod !== 0 && /AAB ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR/.test(r3.cikti), r3.cikti.slice(-500));
  const r4 = buildApk(a, [`--verify-only=${aab(a)}`]);
  ol('3o4 AAB --aab olmadan doğrulanmaz (tür uyuşmazlığı) → DUR', r4.kod !== 0 && /Paket türü komutla uyuşmuyor/.test(r4.cikti), r4.cikti.slice(-400));
  const r5 = buildApk(a, ['--aab', `--verify-only=${aab(a, { zincir: null })}`]);
  ol('3o5 K-2: zincir meta-data\'sı yok AAB → DUR', r5.kod !== 0 && /AAB ORTAK PAKETİN KİMLİĞİNİ TAŞIMIYOR/.test(r5.cikti) && /CERTIFICATE_CHAIN "yok"/.test(r5.cikti), r5.cikti.slice(-600));
  const r6 = buildApk(a, ['--aab', `--verify-only=${aab(a, { zincir: 'false' })}`]);
  ol('3o6 K-2: zincir meta-data\'sı derlenmiş false AAB → DUR (bayt araması değil öğe çözümü)', r6.kod !== 0 && /CERTIFICATE_CHAIN "false"/.test(r6.cikti), r6.cikti.slice(-600));
  const r7 = buildApk(a, ['--aab', `--verify-only=${aab(a, { sertPem: SERT_YABANCI })}`]);
  ol('3o7 K-2: yabancı OTA kökü gömülü AAB → DUR', r7.kod !== 0 && /gömülü OTA sertifikası ortak paketinki değil/.test(r7.cikti), r7.cikti.slice(-600));
  const r8 = buildApk(a, ['--aab', `--verify-only=${aab(a, { hedefSdk: '35' })}`]);
  ol('3o8 API 36: hedef SDK 35 olan AAB → DUR (Play reddi 2026-10-08)', r8.kod !== 0 && /targetSdkVersion 35 < 36/.test(r8.cikti), r8.cikti.slice(-600));
  const r9 = buildApk(a, ['--aab', `--verify-only=${aab(a, { yonOzelligi: null })}`]);
  ol('3o9 API 36: büyük ekran yön özelliği olmayan AAB → DUR', r9.kod !== 0 && /PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY yok/.test(r9.cikti), r9.cikti.slice(-600));
  const r10 = buildApk(a, ['--aab', `--verify-only=${aab(a, { yonOzelligi: 'false' })}`]);
  ol('3o10 API 36: yön özelliği false olan AAB → DUR', r10.kod !== 0 && /PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY yok/.test(r10.cikti), r10.cikti.slice(-600));
  const r11 = buildApk(a, ['--aab', `--verify-only=${aab(a, { cleartext: 'true' })}`]);
  ol('3o11 K3: usesCleartextTraffic=true olan AAB → DUR', r11.kod !== 0 && /usesCleartextTraffic=true/.test(r11.cikti), r11.cikti.slice(-600));
  const r11b = buildApk(a, ['--aab', `--verify-only=${aab(a, { cleartext: null })}`]);
  ol('3o11b K3: usesCleartextTraffic beyansız AAB (varsayılan açık sayılır) → DUR', r11b.kod !== 0 && /usesCleartextTraffic=\(yok\)/.test(r11b.cikti), r11b.cikti.slice(-600));
  const r12 = buildApk(a, ['--aab', `--verify-only=${aab(a, { izinler: ['android.permission.SYSTEM_ALERT_WINDOW'] })}`]);
  ol('3o12 K1: SYSTEM_ALERT_WINDOW izinli AAB → DUR', r12.kod !== 0 && /SYSTEM_ALERT_WINDOW izni var/.test(r12.cikti), r12.cikti.slice(-600));
  const r13 = buildApk(a, ['--aab', `--verify-only=${aab(a, { hizmetler: ['expo.modules.audio.service.AudioControlsService'] })}`]);
  ol('3o13 K1: AudioControlsService hizmetli AAB → DUR', r13.kod !== 0 && /AudioControlsService hizmeti var/.test(r13.cikti), r13.cikti.slice(-600));
  const r14 = buildApk(a, ['--aab', `--verify-only=${aab(a, { nsc: { capalar: ['system', 'user'] } })}`]);
  ol('3o14 G2: kullanıcı CA\'sına güvenen AAB → DUR', r14.kod !== 0 && /güven çapası \[system, user\]/.test(r14.cikti), r14.cikti.slice(-600));
  const r15 = buildApk(a, ['--aab', `--verify-only=${aab(a, { nsc: null, nscOz: false })}`]);
  ol('3o15 G2: ağ güvenlik yapılandırması olmayan AAB → DUR', r15.kod !== 0 && /networkSecurityConfig yok/.test(r15.cikti) && /network_security_config\.xml yok/.test(r15.cikti), r15.cikti.slice(-600));
  const r16 = buildApk(a, ['--aab', `--verify-only=${aab(a, { nsc: { cleartext: 'true' } })}`]);
  ol('3o16 G2: yapılandırmada şifresiz açık AAB → DUR (http yok)', r16.kod !== 0 && /cleartextTrafficPermitted=true/.test(r16.cikti), r16.cikti.slice(-600));
  const r17 = buildApk(a, ['--aab', `--verify-only=${aab(a, { nsc: { alan: true } })}`]);
  ol('3o17 G2: alan adına özel istisnalı AAB → DUR', r17.kod !== 0 && /domain-config/.test(r17.cikti), r17.cikti.slice(-600));
}
const AJ = JSON.parse(fs.readFileSync(path.join(KOK, 'mobil/app.json'), 'utf8')).expo;
const androidYaz = ({ url = kimlik.guncellemeUrl, paket = kimlik.androidPaket, ad = kimlik.gorunenAd, zincir = 'true', sert = SERT_KANAL } = {}) => (dir) => {
  const yaz = (rel, s) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), s); };
  yaz('app/build.gradle', `android {\n  defaultConfig {\n    applicationId '${paket}'\n    versionCode ${AJ.android.versionCode}\n    versionName "${AJ.version}"\n  }\n}\n`);
  yaz('app/src/main/res/values/strings.xml', `<resources>\n  <string name="app_name">${ad}</string>\n  <string name="expo_runtime_version">${kimlik.runtimeVersion}</string>\n</resources>\n`);
  yaz('app/src/main/AndroidManifest.xml', `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n<application>\n` +
    `<meta-data android:name="expo.modules.updates.ENABLED" android:value="true"/>\n` +
    `<meta-data android:name="expo.modules.updates.EXPO_UPDATE_URL" android:value="${url}"/>\n` +
    `<meta-data android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"/>\n` +
    `<meta-data android:name="expo.modules.updates.CODE_SIGNING_CERTIFICATE" android:value="${sert.replace(/\n/g, '&#10;')}"/>\n` +
    (zincir == null ? '' : `<meta-data android:name="${Z.ZINCIR_META}" android:value="${zincir}"/>\n`) +
    `<meta-data android:name="expo.modules.updates.CODE_SIGNING_METADATA" android:value="{&quot;keyid&quot;:&quot;ortak&quot;,&quot;alg&quot;:&quot;rsa-v1_5-sha256&quot;}"/>\n` +
    `</application>\n</manifest>\n`);
};
{
  const a = agacKur({ android: androidYaz() }); const r = buildApk(a, ['--check']);
  ol('3j --check: android/ ortak paketle tutarlı', /✔ Uzaktan güncelleme yapılandırması ortak paketle tutarlı/.test(r.cikti), r.cikti.slice(-700));
  const b = agacKur({ android: androidYaz({ url: 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest' }) }); const r2 = buildApk(b, ['--check']);
  ol('3j2 --check: eski URL\'li manifest → ORTAK PAKETE HAZIR DEĞİL', r2.kod !== 0 && /ANDROIDMANIFEST ORTAK PAKETE HAZIR DEĞİL/.test(r2.cikti), r2.cikti.slice(-600));
  const c = agacKur({ android: androidYaz({ zincir: null }) }); const r3 = buildApk(c, ['--check']);
  ol('3j3 K-2: --check: prebuild manifestinde zincir meta-data\'sı yok → ORTAK PAKETE HAZIR DEĞİL', r3.kod !== 0 && /ANDROIDMANIFEST ORTAK PAKETE HAZIR DEĞİL/.test(r3.cikti) &&
    /CERTIFICATE_CHAIN "yok"/.test(r3.cikti), r3.cikti.slice(-600));
}

console.log('\n§4 — kablolama: commit kancası + CI bu bekçiyi koşturur');
{
  const kanca = fs.readFileSync(path.join(KOK, 'scripts/hooks/pre-commit.mjs'), 'utf8');
  const ci = fs.readFileSync(path.join(KOK, '.github/workflows/ci.yml'), 'utf8');
  ol('4a commit kancası bekçiyi koşturur; tetik kimliği üreten/okunan dosyaları kapsar',
    /test_tablet_ortak_paket\.mjs/.test(kanca) && ['ortak-kimlik.cjs', 'build-apk.mjs', 'app.config.js', 'app.json', 'deploy/dagitim.json', 'mobil/scripts/', 'scripts/lib/', 'mobil/plugins/'].every((x) => kanca.includes(x)));
  ol('4b CI bekçiyi iki kipte (--sonda dahil) koşturur', /test_tablet_ortak_paket\.mjs && node scripts\/test_tablet_ortak_paket\.mjs --sonda/.test(ci));
}

bitir();

function bitir() {
  console.log(`\n${basarili} geçti, ${hatalar.length} kırmızı`);
  if (hatalar.length) { console.log(`KIRMIZI: ${hatalar.join(' | ')}`); process.exit(1); }
  process.exit(0);
}
