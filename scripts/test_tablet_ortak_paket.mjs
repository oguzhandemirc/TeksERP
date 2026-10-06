#!/usr/bin/env node
// =============================================================================
// BEKÇİ — TEK ORTAK PAKETİN TABLET KİMLİĞİ (O7) · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// Ortak paket = `--musteri`/`TEKSERP_KANAL` YOKKEN derlenen tablet paketi. Kimlik YALNIZ `deploy/dagitim.json`
// `urun.tablet`ten gelir (`mobil/scripts/lib/ortak-kimlik.cjs`); eski kanal (adnansahin) app.json'da bayt-donuk kalır.
//
// NE ÖLÇER:
//   §1 ortak-kimlik.cjs ↔ kayıt: her alan kayıttan bağımsız yeniden türetilmiş değerle eşit; güncelleme adresi
//      grup-nötr Worker takma adı = dagitim.mjs `turet().otaTakmaAd`; kid + anahtar yolu sertifika dizininden
//   §2 app.config.js argümansız (TEKSERP_KANAL yok) → değerlendirilmiş yapılandırma ortak kimlikle farksız
//   §3 build-apk.mjs ortak yol (geçici ağaç, ağsız, `--yoklama-yok`): ortak APK geçer ama mühürde durur · bundle'da ERP
//      adresi · eski kimlikli APK · yabancı sertifika · gorunurEtiket · TEKSERP_KANAL · --api-url · sertifikasız ağaç ·
//      şema dışı kayıt → DUR; `--check` android/ ortak paketle tutarlı mı
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
const SONDA = process.argv.includes('--sonda');
const GERCEK_GIT = 'git';
const TEMIZ_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(GIT_|TEKSERP_KANAL$|EXPO_PUBLIC_|EXPO_NO_DOTENV$)/.test(k)));

let basarili = 0;
const hatalar = [];
function ol(ad, kosul, ayrinti = '') {
  if (kosul) { basarili += 1; console.log(`  ✓ ${ad}`); } else { hatalar.push(ad); console.log(`  ✗ ${ad}${ayrinti ? `\n      ${String(ayrinti).replace(/\n/g, '\n      ')}` : ''}`); }
}

/* ---- sahte APK yapıtaşları (test_kanal_yayin_kapisi.mjs §5 ile aynı biçim) ---- */
const SERT_KANAL = `-----BEGIN CERTIFICATE-----
MIIBlzCCAT2gAwIBAgIUflh7ucW2BFPsCatHKIKPJkPevBswCgYIKoZIzj0EAwIw
IDEeMBwGA1UEAwwVdGVrc2VycC1iZWtjaS1zYWh0ZS0xMCAXDTI2MTAwMTA0NTAz
M1oYDzIxMjYwOTA3MDQ1MDMzWjAgMR4wHAYDVQQDDBV0ZWtzZXJwLWJla2NpLXNh
aHRlLTEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARTZhs6Ki1buTYtoq0PSkcW
d+6GLQOhtKd4fpXs2HqRg6uE2Ig+bzRD8LKeZq69fQAAwycx1exOgYsEP0KhN/BP
o1MwUTAdBgNVHQ4EFgQUbhn1aseIZJPE31mOfQPJ93zxJFowHwYDVR0jBBgwFoAU
bhn1aseIZJPE31mOfQPJ93zxJFowDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQD
AgNIADBFAiAwCh7GhiovwejsCV29+3eg4cSMaz6p9UhuXgtuTSoSowIhAK030NKN
qLvA5jkZDdfpFiK0fV5ugAjzgFTm59VZ4Bp3
-----END CERTIFICATE-----\n`;
const SERT_YABANCI = `-----BEGIN CERTIFICATE-----
MIIBlzCCAT2gAwIBAgIUSuhn5eU2yQWa431DeUZotX3i554wCgYIKoZIzj0EAwIw
IDEeMBwGA1UEAwwVdGVrc2VycC1iZWtjaS1zYWh0ZS0yMCAXDTI2MTAwMTA0NTAz
M1oYDzIxMjYwOTA3MDQ1MDMzWjAgMR4wHAYDVQQDDBV0ZWtzZXJwLWJla2NpLXNh
aHRlLTIwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAAR6dd49sLhWkopLDiCLcBx2
nQUcWI/ABS78q26RBtNhG5T4Whxcwt+1nVOUuvOVUHjLWSNXCZeomQOfhzBHLTBM
o1MwUTAdBgNVHQ4EFgQUpmXR20hhG3KeUHZ+5t6IJXgO1gIwHwYDVR0jBBgwFoAU
pmXR20hhG3KeUHZ+5t6IJXgO1gIwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQD
AgNIADBFAiBZaAQAn94UOeYS86lmJlv+EDkl71vcPEUAl8ejfSvC7QIhAI7EPfcN
eJLdB4D4AGuTFs7CcX2bwKbS+Y4nwQ3iY6F5
-----END CERTIFICATE-----\n`;
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
function axmlYaz({ paket, meta = {}, surumAdi = null, surumKodu = null }) {
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
  e('otaAnahtar', k.otaAnahtar, `keystore/ota-keys-${ad}/private-key.pem`);
  e('guncellemeUrl (kayıt şablonu)', k.guncellemeUrl, `${kayit.indirmeKoku}ota/${t.runtimeVersion}/manifest`);
  e('guncellemeUrl (dagitim.mjs türetimi)', k.guncellemeUrl, turet(kayit).otaTakmaAd);
  // Grup-nötr: adres hiçbir grup kodunu yol öneki olarak taşımaz.
  for (const g of kayit.gruplar) if (k.guncellemeUrl.startsWith(`${kayit.indirmeKoku}${g.kod}/`)) f.push(`güncelleme adresi grup "${g.kod}" taşıyor`);
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
  bitir();
}

console.log('§1 — ortak-kimlik.cjs ↔ deploy/dagitim.json');
{
  const f = kimlikFarki(kayit, kimlik);
  ol('1a kimlik kayıttan türer (paket · ad · rv · sertifika · kid · anahtar yolu · adres)', f.length === 0, f.join('\n'));
  ol('1b güncelleme adresi grup-nötr Worker takma adı', kimlik.guncellemeUrl === `${kayit.indirmeKoku}ota/${kayit.urun.tablet.runtimeVersion}/manifest`, kimlik.guncellemeUrl);
  const yol = ORTAK.anahtarToreniKomutu(kimlik).join('\n');
  ol('1c anahtar töreni komutu kimlikten (sertifika + anahtar dizini, chmod 600)', /codesigning:generate/.test(yol) && yol.includes('ota-keys-ortak') && yol.includes('ota-certs-ortak') && /chmod 600/.test(yol), yol);
}
console.log('\n§2 — app.config.js argümansız = ortak kimlik');
{
  const f = ORTAK.ortakYapilandirmaFarki(cfg);
  ol('2a değerlendirilmiş yapılandırma ortak kimlikle farksız', f.length === 0, f.join('\n'));
  ol('2b ERP adresi yapılandırmaya girmez (extra.apiUrl/EXPO_PUBLIC_API_URL yok)', !/\b(apiUrl|api_url|EXPO_PUBLIC_API_URL)\b/i.test(JSON.stringify(cfg.extra ?? {})), JSON.stringify(cfg.extra));
}

/* ------------------------------------------------------------------ *
 * §3 build-apk.mjs ortak yolu — geçici ağaç
 * ------------------------------------------------------------------ */
console.log('\n§3 — build-apk.mjs ortak yol (geçici ağaç, ağsız)');
const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'tablet-ortak-'));
process.on('exit', () => fs.rmSync(GECICI, { recursive: true, force: true }));
let sayac = 0;
const git = (cwd, ...a) => spawnSync(GERCEK_GIT, ['-c', 'user.email=bekci@test', '-c', 'user.name=bekci', ...a], { cwd, env: TEMIZ_ENV, encoding: 'utf8' });

function agacKur({ sert = SERT_KANAL, kayitDegistir = null, android = null } = {}) {
  sayac += 1;
  const agac = path.join(GECICI, `agac-${sayac}`);
  fs.cpSync(path.join(KOK, 'scripts/lib'), path.join(agac, 'scripts/lib'), { recursive: true });
  fs.cpSync(path.join(KOK, 'mobil/scripts'), path.join(agac, 'mobil/scripts'), { recursive: true });
  for (const rel of ['mobil/app.json', 'mobil/app.config.js', 'mobil/package.json', 'mobil/musteri.json', 'deploy/kanallar.json', 'surum-notlari.json']) {
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
function apk(agac, { paket = kimlik.androidPaket, url = kimlik.guncellemeUrl, bundle = 'hermes\u0000/api/auth/login\u0000son', sertPem = SERT_KANAL, appConfig = ORTAK_CFG } = {}) {
  sayac += 1;
  const y = path.join(agac, `sahte-${sayac}.apk`);
  const meta = { 'expo.modules.updates.ENABLED': 'true', 'expo.modules.updates.EXPO_UPDATE_URL': url };
  if (sertPem) meta['expo.modules.updates.CODE_SIGNING_CERTIFICATE'] = sertPem;
  const g = [
    { ad: 'AndroidManifest.xml', veri: axmlYaz({ paket, meta, surumAdi: '1.0.0', surumKodu: 1 }), yontem: 8 },
    { ad: 'assets/index.android.bundle', veri: Buffer.from(bundle, 'latin1'), yontem: 0 },
  ];
  if (appConfig) g.push({ ad: 'assets/app.config', veri: Buffer.from(JSON.stringify(appConfig)), yontem: 8 });
  zipYaz(y, g);
  return y;
}
function buildApk(agac, args, ortamEk = {}) {
  const r = spawnSync(process.execPath, [path.join(agac, 'mobil/scripts/build-apk.mjs'), '--yoklama-yok', ...args], {
    cwd: path.join(agac, 'mobil'), encoding: 'utf8', timeout: 120_000, env: { ...TEMIZ_ENV, ...ortamEk },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const dogrula = (agac, y, ortamEk) => buildApk(agac, [`--verify-only=${y}`], ortamEk);

{
  const a = agacKur(); const r = dogrula(a, apk(a));
  ol('3a ortak kimlikli APK → kimlik + bundle geçer, MÜHÜRDE durur (mühür ağaçta yok)',
    r.kod !== 0 && /RELEASE APK \(ORTAK PAKET\)/.test(r.cikti) && /✔ APK ortak paketin kimliğini taşıyor/.test(r.cikti) &&
      /✔ Bundle'da ERP adresi yok/.test(r.cikti) && /RELEASE MÜHRÜ BULUNAMADI/.test(r.cikti), r.cikti.slice(-700));
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
  ol('3f ortamda TEKSERP_KANAL → KANAL ÇELİŞKİSİ', r.kod !== 0 && /KANAL ÇELİŞKİSİ/.test(r.cikti), r.cikti.slice(-400));
}
{
  const a = agacKur(); const r = buildApk(a, ['--api-url=http://192.168.1.250:4000/api', `--verify-only=${apk(a)}`]);
  ol('3g --api-url → ORTAK PAKET ERP ADRESİ GÖMMEZ', r.kod !== 0 && /ORTAK PAKET ERP ADRESİ GÖMMEZ/.test(r.cikti), r.cikti.slice(-400));
}
{
  const a = agacKur({ sert: null }); const r = dogrula(a, apk(a));
  ol('3h sertifikasız ağaç → ORTAK OTA SERTİFİKASI YOK + anahtar töreni komutu',
    r.kod !== 0 && /ORTAK OTA SERTİFİKASI YOK/.test(r.cikti) && /codesigning:generate/.test(r.cikti), r.cikti.slice(-500));
}
{
  const a = agacKur({ kayitDegistir: (k) => { k.urun.tablet.musteriAdi = 'x'; } }); const r = dogrula(a, apk(a));
  ol('3i dagitim.json şema dışı anahtar → DAĞITIM KAYDI GEÇERSİZ', r.kod !== 0 && /DAĞITIM KAYDI GEÇERSİZ/.test(r.cikti), r.cikti.slice(-500));
}
const AJ = JSON.parse(fs.readFileSync(path.join(KOK, 'mobil/app.json'), 'utf8')).expo;
const androidYaz = ({ url = kimlik.guncellemeUrl, paket = kimlik.androidPaket, ad = kimlik.gorunenAd } = {}) => (dir) => {
  const yaz = (rel, s) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), s); };
  yaz('app/build.gradle', `android {\n  defaultConfig {\n    applicationId '${paket}'\n    versionCode ${AJ.android.versionCode}\n    versionName "${AJ.version}"\n  }\n}\n`);
  yaz('app/src/main/res/values/strings.xml', `<resources>\n  <string name="app_name">${ad}</string>\n  <string name="expo_runtime_version">${kimlik.runtimeVersion}</string>\n</resources>\n`);
  yaz('app/src/main/AndroidManifest.xml', `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n<application>\n` +
    `<meta-data android:name="expo.modules.updates.ENABLED" android:value="true"/>\n` +
    `<meta-data android:name="expo.modules.updates.EXPO_UPDATE_URL" android:value="${url}"/>\n` +
    `<meta-data android:name="expo.modules.updates.EXPO_RUNTIME_VERSION" android:value="@string/expo_runtime_version"/>\n` +
    `<meta-data android:name="expo.modules.updates.CODE_SIGNING_CERTIFICATE" android:value="${SERT_KANAL.replace(/\n/g, '&#10;')}"/>\n` +
    `<meta-data android:name="expo.modules.updates.CODE_SIGNING_METADATA" android:value="{&quot;keyid&quot;:&quot;ortak&quot;,&quot;alg&quot;:&quot;rsa-v1_5-sha256&quot;}"/>\n` +
    `</application>\n</manifest>\n`);
};
{
  const a = agacKur({ android: androidYaz() }); const r = buildApk(a, ['--check']);
  ol('3j --check: android/ ortak paketle tutarlı', /✔ Uzaktan güncelleme yapılandırması ortak paketle tutarlı/.test(r.cikti), r.cikti.slice(-700));
  const b = agacKur({ android: androidYaz({ url: 'https://guncelleme.etkiliyazilim.com/adnansahin/mobil/ota/54.2/manifest' }) }); const r2 = buildApk(b, ['--check']);
  ol('3j2 --check: eski URL\'li manifest → ORTAK PAKETE HAZIR DEĞİL', r2.kod !== 0 && /ANDROIDMANIFEST ORTAK PAKETE HAZIR DEĞİL/.test(r2.cikti), r2.cikti.slice(-600));
}

console.log('\n§4 — kablolama: commit kancası + CI bu bekçiyi koşturur');
{
  const kanca = fs.readFileSync(path.join(KOK, 'scripts/hooks/pre-commit.mjs'), 'utf8');
  const ci = fs.readFileSync(path.join(KOK, '.github/workflows/ci.yml'), 'utf8');
  ol('4a commit kancası bekçiyi koşturur; tetik kimliği üreten/okunan dosyaları kapsar',
    /test_tablet_ortak_paket\.mjs/.test(kanca) && ['ortak-kimlik.cjs', 'build-apk.mjs', 'app.config.js', 'app.json', 'deploy/dagitim.json', 'mobil/scripts/', 'scripts/lib/'].every((x) => kanca.includes(x)));
  ol('4b CI bekçiyi iki kipte (--sonda dahil) koşturur', /test_tablet_ortak_paket\.mjs && node scripts\/test_tablet_ortak_paket\.mjs --sonda/.test(ci));
}

bitir();

function bitir() {
  console.log(`\n${basarili} geçti, ${hatalar.length} kırmızı`);
  if (hatalar.length) { console.log(`KIRMIZI: ${hatalar.join(' | ')}`); process.exit(1); }
  process.exit(0);
}
