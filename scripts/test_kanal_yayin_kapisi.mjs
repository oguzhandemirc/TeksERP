#!/usr/bin/env node
// =============================================================================
// BEKÇİ — yayın betiklerinin KANAL KAPILARI (K2/K4) · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// Yayın betiklerini GERÇEKTEN koşturur, ama dünyaya dokunmadan: PATH'in önüne
// sahte `ssh` · `scp` · `curl` · `git` · `npm` · `npx` konur.
//   ssh/scp → geçici bir "sahte uzak" dizine (komutlar yol yeniden yazılarak orada koşar)
//   curl    → yalnız guncelleme.etkiliyazilim.com, sahte uzaktan cevaplanır; başka her
//             adres KIRMIZI (ağa çıkma girişimi); `-H @dosya` ile X-TKL-Indirme taşıyıp
//             taşımadığı kaydedilir (3c': güncelleme sunucusu anonim okumaya kapalı)
//   git     → okuma serbest, `tag -a`/`push` ENGELLENİR ve kaydedilir
//   npm     → `run build:win*` iki derleyicinin KİMLİK çıktılarını üretir: electron-builder
//             package.json + `-c.*` argümanlarından (app-update.yml url + updaterCacheDirName,
//             exe adı, latest.yml, paketin package.json'ı — extraMetadata), electron-vite
//             `TEKSERP_KANAL` (yoksa işaretçi) + kayıttan (app.asar içinde main.js AUMID/adres,
//             arayüzün varsayılan sunucusu/etiketi/başlığı)
//   npx     → kaydedilir, 0 döner (paketlemenin vitest adımı; ayrı bekçisi var)
// Kabuk betikleri (electron-*.sh) geçici bir ağaç KOPYASINDA koşar — gerçek
// `Electron/release/`e ve musteri.json'a dokunulmaz. mobil-yayinla.mjs `--kuru`,
// yayinla-ota.mjs `--check` ile gerçek ağaçtan koşar (ikisi de o kiplerde yazmaz).
//
// NE ÖLÇER:
//   §1 electron-yayinla.sh — hedef PAKETİN kimliğinden; niyet (--musteri) ≠ paket → ssh'tan ÖNCE dur;
//      paketin İÇİ (asar package.json · ana süreç · arayüz) başka kanalınsa dur; --kuru ağa hiç çıkmaz
//      yayın belirteci yoksa/gevşekse/biçimsizse ağdan ÖNCE dur; kenar curl'leri belirteçli (1s–1x)
//   §2 electron-paketle.sh — bilinmeyen kanal → hiçbir dosya yazılmadan dur; kimlik derleme ANINDA
//      enjekte edilir: testfabrika paketi kendi kimliğiyle doğar, iki paketleme de dinlenmedeki
//      dosyaları BAYT BAYT aynı bırakır; enjeksiyonun iki bacağından biri düşerse paket DURUR
//   §3 mobil-yayinla.mjs — OTA künye/bundle ve APK bundle ERP adresi kanalın adresi değilse dur;
//      okunamayan bundle/manifest ÖLÇÜLEMEDİ = dur; --kuru etiket atmaz
//   §4 yayinla-ota.mjs — çözülen ERP adresi kanalın değilse ağdan ÖNCE dur; testfabrika kanalı kendi
//      kimliğiyle geçer ve native parmak izi kanaldan BAĞIMSIZ (iki kanalda aynı); app.json kanal için
//      yeniden yazılmışsa dur
//   §5 yüklemler (lib): zip okuyucu, bundle ölçümü, tablet kimliği, ikili manifest (AXML) okuyucu
//   §6 build-apk.mjs — kanal ARGÜMANDAN (kapalı küme), ERP adresi kanalın; APK'nın KENDİ paket adı /
//      güncelleme adresi / OTA sertifikası / çalışma anı yapılandırması hedef kanalın değilse dur
//   §8 panel İMZALI KÜNYE — imzasız/geçersiz künyeli latest.yml YÜKLENMEZ (anahtarsız imzasız · imza aracı
//      imzalamadıysa · yabancı anahtar · başka kanal · kurcalanmış exe · boş çapa · çapası gömülmemiş paket ·
//      rotasyon kilidi · kopuk ssh); --kuru imzalamaz; --dogrula kenardaki künyeyi denetler; paketleme boş
//      çapada derlemez. Sahte paketler bekçinin TEST anahtarıyla imzalanır (geçici ağacın çapası o anahtar).
//
// `--eski=<git-ref>`: §1a/§2c'nin İZİNİ o ref'teki betiklerle de çıkarır ve
// karşılaştırır (adnansahin için "davranış değişmedi" ölçümü).
//
//   node scripts/test_kanal_yayin_kapisi.mjs [--eski=<ref>]
// =============================================================================

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  asarOku, kanalBekcisiTetigi, kanalCoz, tabletSabitKimlikFarki, panelSabitKimlikFarki, panelDerlemeAyarlari, dosyalariOku,
  TABLET_SABIT_DOSYALAR, PANEL_SABIT_DOSYALAR,
} from './lib/kanallar.mjs';
import { bundleAdresOlcumu } from '../mobil/scripts/lib/adres.mjs';
import { zipGirdisiOku } from '../mobil/scripts/lib/zip.mjs';
import { apkKimligi, axmlOgeleri } from '../mobil/scripts/lib/apk-kimlik.mjs';
import { imzaBasligi, imzayiKabulEdenler, multipartKur } from '../mobil/scripts/lib/manifest.mjs';
import { buildReleaseDoc, signReleaseDoc } from '../Electron/electron/guncelleme/panel-kunye.mjs';
import { withReleaseBlock } from '../Electron/electron/guncelleme/latest-yml.mjs';
import { apkDosyaAdi, buildApkDoc, signApkDoc, withApkBlock } from '../mobil/scripts/lib/apk-kunye.mjs';
import { YAYIN_EZME_ORTAMLARI } from './lib/yayin-hedefi.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESKI = (process.argv.find((a) => a.startsWith('--eski=')) ?? '').slice('--eski='.length) || null;
const FABRIKA_ERP = 'http://192.168.1.250:4000/api';
const TEST_ERP = 'http://100.70.47.46:4000/api';
const YAYIN_HOST = 'https://guncelleme.etkiliyazilim.com/';
const VDS = '/opt/stack/apps/tekserp-guncelleme';

let gecti = 0;
const kaldi = [];
function ol(ad, kosul, detay) {
  if (kosul) {
    gecti += 1;
    console.log(`✅ ${ad}`);
  } else {
    kaldi.push(ad);
    console.log(`❌ ${ad}${detay ? `\n   ${String(detay).split('\n').slice(0, 12).join('\n   ')}` : ''}`);
  }
}

const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-kanal-'));
process.on('exit', () => fs.rmSync(GECICI, { recursive: true, force: true }));
const GERCEK_GIT = execFileSync('/usr/bin/env', ['sh', '-c', 'command -v git'], { encoding: 'utf8' }).trim();
// GIT_* SÖKÜLÜR: bekçi commit kapısından koşarsa hook ortamı GIT_DIR/GIT_INDEX_FILE taşır ve
// geçici ağaçtaki `git init` GERÇEK depoya yazar (pre-commit.mjs `gitEnvSil` gerekçesi).
const TEMIZ_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), TEKSERP_YAYIN_BILDIRIMI: '0' };
// Yayın hedefi ezmeleri yükleyiciyi DURDURUR (G22): koşturanın kabuğunda kalmış biri bütün senaryoları düşürmesin.
for (const ad of YAYIN_EZME_ORTAMLARI) delete TEMIZ_ENV[ad];
delete TEMIZ_ENV.TEKSERP_PANEL_IMZA_ANAHTARI;
delete TEMIZ_ENV.TEKSERP_TABLET_IMZA_ANAHTARI;

// Panel künye imzası (§8): bekçinin TEST anahtarları — geçici ağacın çapası bunlardır, gerçek çapaya dokunulmaz.
const imzaAnahtari = (kid) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { kid, privateKey, x: publicKey.export({ format: 'jwk' }).x };
};
const IMZA = imzaAnahtari('panel-2099');
const IMZA_ONCEKI = imzaAnahtari('panel-2098');
const IMZA_YABANCI = imzaAnahtari('panel-2097');
const TEST_CAPA = [{ kid: IMZA.kid, x: IMZA.x }];
const PANEL_CAPA_REL = 'Electron/electron/guncelleme/imza-capasi.json';
const capaMetni = (liste) => `${JSON.stringify({ _aciklama: ['bekçi çapası (geçici ağaç)'], anahtarlar: liste }, null, 2)}\n`;
// Tablet APK künyesi (G6): geçici mobil ağacın çapası aynı TEST anahtarıdır; paket/APK bundle'ı çapa dizelerini taşır.
const TABLET_CAPA_REL = 'mobil/src/lib/apk-imza-capasi.json';
const capaDizeleri = (liste) => liste.map((k) => `\u0000${k.kid}\u0000${k.x}`).join('');
// Bekçinin SAHTE OTA kod imzası sertifikaları (yalnız açık sertifika; özel yarı üretimde atıldı) — geçici ağaçta
// kanalın `otaSertifika` yoluna SERT_KANAL yazılır; SERT_YABANCI başka bir kanalın/elle derlemenin sertifikasıdır.
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
function kunyeYaz(dizin, { surum, kanal, anahtar = IMZA, capa = TEST_CAPA.map((k) => k.kid) }) {
  const yml = path.join(dizin, 'latest.yml');
  const ad = `TeksERP-${surum}-Setup.exe`;
  const govde = fs.readFileSync(path.join(dizin, ad));
  const doc = buildReleaseDoc({
    kanal, surum, commit: 'abcdef0', yayinZamani: '2026-10-01T01:00:00.000Z',
    paket: { ad, boyut: govde.length, sha512: crypto.createHash('sha512').update(govde).digest('hex') }, capa,
  });
  fs.writeFileSync(yml, withReleaseBlock(fs.readFileSync(yml, 'utf8'), signReleaseDoc({ doc, kid: anahtar.kid, privateKey: anahtar.privateKey })));
}

/* ------------------------------------------------------------------ *
 * Sahte araçlar
 * ------------------------------------------------------------------ */

const SAHTE = path.join(GECICI, 'sahte-arac.mjs');
fs.writeFileSync(SAHTE, String.raw`
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [arac, ...a] = process.argv.slice(2);
const UZAK = process.env.SAHTE_UZAK;
const yaz = (o) => fs.appendFileSync(process.env.CAGRI_LOG, JSON.stringify({ arac, ...o }) + '\n');
const uzakYol = (p) => path.join(UZAK, p);
const HOST = 'https://guncelleme.etkiliyazilim.com/';
const stdinOku = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };

if (arac === 'ssh') {
  const k = [...a];
  while (k.length && k[0].startsWith('-')) { const o = k.shift(); if (o === '-p' || o === '-o') k.shift(); }
  const host = k.shift();
  const komut = k.join(' ');
  if (/^bash -s\b/.test(komut)) {
    // Konumsal argümanlı uzak betik: betik stdin'den, değerler '--'dan sonra. Budama koşturulmaz (uzak ağacı korur).
    const betik = stdinOku();
    const i = k.indexOf('--');
    const argv = i >= 0 ? k.slice(i + 1) : [];
    if (/ls -1t TeksERP-/.test(betik)) { yaz({ host, komut, tur: 'budama' }); process.exit(0); }
    yaz({ host, komut, betik, argv });
    if (process.env.SAHTE_SSH_KOPUK && [komut, betik].some((x) => x.includes(process.env.SAHTE_SSH_KOPUK))) { process.stderr.write('ssh: connect to host: Connection refused\n'); process.exit(255); }
    const r = spawnSync('bash', ['-s', '--', ...argv.map((x) => x.replaceAll('/opt/stack', UZAK + '/opt/stack'))], { input: betik });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }
  yaz({ host, komut });
  // Kopuk ssh taklidi (bağlantı reddi, çıkış 255): okunamayan kaynak = ÖLÇÜLEMEDİ sondası.
  if (process.env.SAHTE_SSH_KOPUK && komut.includes(process.env.SAHTE_SSH_KOPUK)) { process.stderr.write('ssh: connect to host: Connection refused\n'); process.exit(255); }
  const r = spawnSync('bash', ['-c', komut.replaceAll('/opt/stack', UZAK + '/opt/stack')], { encoding: 'utf8' });
  process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? '');
  process.exit(r.status ?? 1);
}
if (arac === 'scp') {
  const k = a.filter((x, i) => !['-r', '-s', '-q', '-P'].includes(x) && a[i - 1] !== '-P');
  const hedef = k.pop();
  const [host, uzak] = hedef.split(/:(.*)/s);
  yaz({ host, kaynaklar: k.map((x) => path.basename(x)), hedef: uzak });
  for (const kaynak of k) {
    const hedefDosya = uzak.endsWith('/') ? path.join(uzakYol(uzak), path.basename(kaynak)) : uzakYol(uzak);
    if (!fs.existsSync(path.dirname(hedefDosya))) { process.stderr.write('scp: hedef dizin yok: ' + uzak + '\n'); process.exit(1); }
    fs.cpSync(kaynak, hedefDosya, { recursive: true });
  }
  process.exit(0);
}
if (arac === 'curl') {
  const url = a.find((x) => /^https?:\/\//.test(x));
  const wi = a.indexOf('-w');
  const bicim = wi >= 0 ? a[wi + 1] : null;
  const bas = a.includes('-I');
  const f = a.some((x) => /^-[a-zA-Z]*f/.test(x));
  const tem = (url ?? '').split('?')[0];
  // Belirteç başlığı (3c'): -H @dosya ile gelir; dosyada X-TKL-Indirme satırı var mı?
  const hi = a.indexOf('-H');
  let belirtec = false;
  if (hi >= 0 && String(a[hi + 1]).startsWith('@')) {
    try { belirtec = /^X-TKL-Indirme: \S+$/m.test(fs.readFileSync(a[hi + 1].slice(1), 'utf8')); } catch { belirtec = false; }
  }
  yaz({ url: tem, bas, belirtec });
  if (!tem.startsWith(HOST)) { yaz({ YABANCI_AG: tem }); process.exit(6); }
  const dosya = uzakYol('/opt/stack/apps/tekserp-guncelleme/html/' + tem.slice(HOST.length));
  const var_ = fs.existsSync(dosya) && fs.statSync(dosya).isFile();
  if (bicim) {
    // -w ile gövde de istenmişse (terfi kapısının okuması) önce gövde, sonra biçim — gerçek curl gibi.
    if (var_ && !bas && !a.includes('/dev/null')) process.stdout.write(fs.readFileSync(dosya));
    process.stdout.write(bicim.replace('%{http_code}', var_ ? '200' : '404')
      .replace('%{size_download}', var_ && !bas ? String(fs.statSync(dosya).size) : '0'));
    process.exit(0);
  }
  if (!var_) process.exit(f ? 22 : 0);
  if (!a.includes('/dev/null')) process.stdout.write(fs.readFileSync(dosya));
  process.exit(0);
}
if (arac === 'git') {
  const yikici = a[0] === 'push' || (a[0] === 'tag' && a.some((x) => ['-a', '-d', '-f', '-s', '-m'].includes(x)));
  if (yikici) { yaz({ ENGELLENDI: a.join(' ') }); process.exit(1); }
  const r = spawnSync(process.env.GERCEK_GIT, a, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
if (arac === 'npx') { yaz({ args: a.join(' ') }); process.exit(0); }
if (arac === 'npm') {
  yaz({ args: a.join(' '), kanal: process.env.TEKSERP_KANAL || null });
  if (a[0] !== 'run' || !/^build:win/.test(a[1] ?? '')) process.exit(0);
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  // electron-builder: package.json build + '-c.<yol>=<değer>' (publish.* ilk girdiye, extraMetadata paketin package.json'ına)
  const cfg = JSON.parse(JSON.stringify(p.build));
  const meta = { name: p.name, productName: p.productName, version: p.version, description: p.description, main: p.main };
  for (const x of a.slice(2)) {
    const m = /^-c\.([^=]+)=([\s\S]*)$/.exec(x);
    if (!m) continue;
    const yol = m[1].split('.');
    if (yol[0] === 'extraMetadata') { meta[yol[1]] = m[2]; continue; }
    if (yol[0] === 'publish') { cfg.publish[0][yol[1]] = m[2]; continue; }
    let o = cfg;
    for (const k of yol.slice(0, -1)) o = o[k] = o[k] || {};
    o[yol[yol.length - 1]] = m[2];
  }
  const urun = cfg.productName || meta.productName;
  const cikti = cfg.directories.output.replaceAll('$' + '{version}', meta.version);
  const res = path.join(cikti, 'win-unpacked', 'resources');
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, 'app-update.yml'),
    'provider: generic\nurl: ' + cfg.publish[0].url + '\nchannel: latest\nupdaterCacheDirName: ' + meta.name + '-updater\n');
  fs.writeFileSync(path.join(cikti, 'win-unpacked', urun + '.exe'), 'SAHTE ' + meta.name);
  // electron-vite: kanal TEKSERP_KANAL ya da dinlenme işaretçisi → kayıttan gömülen kimlik
  // Kayıt öncesi bir ref'te (--eski) ağaçta kayıt yok: o ref'in gömdüğü kimlik bugünkü kaydın aynı kanalıdır.
  const kayitYolu = fs.existsSync('../deploy/kanallar.json') ? '../deploy/kanallar.json' : process.env.KANAL_KAYDI_YEDEK;
  const kayit = JSON.parse(fs.readFileSync(kayitYolu, 'utf8'));
  const kod = process.env.TEKSERP_KANAL || JSON.parse(fs.readFileSync('shared/musteri.json', 'utf8')).kod;
  const { asarYaz, gomuluKimlik } = await import(process.env.ASAR_YAZ);
  // electron-vite çapa JSON'unu ana sürece gömer (guncelleme-dogrulama.ts → imza-capasi.json).
  const capaYolu = 'electron/guncelleme/imza-capasi.json';
  const capa = fs.existsSync(capaYolu) ? JSON.parse(fs.readFileSync(capaYolu, 'utf8')).anahtarlar : [];
  asarYaz(path.join(res, 'app.asar'), gomuluKimlik(kayit.kanallar[kod], meta, capa));
  const exe = 'TeksERP-' + meta.version + '-Setup.exe';
  const govde = Buffer.from('SAHTE-SETUP ' + meta.name + ' ' + meta.version + ' ' + cfg.publish[0].url);
  fs.writeFileSync(path.join(cikti, exe), govde);
  fs.writeFileSync(path.join(cikti, exe + '.blockmap'), 'SAHTE-BLOCKMAP');
  const sha = crypto.createHash('sha512').update(govde).digest('base64');
  fs.writeFileSync(path.join(cikti, 'latest.yml'),
    'version: ' + meta.version + '\nfiles:\n  - url: ' + exe + '\n    sha512: ' + sha + '\n    size: ' + govde.length + '\npath: ' + exe + '\nsha512: ' + sha + '\n');
  process.exit(0);
}
process.exit(97);
`);
// Asar yazıcı + "electron-vite ne gömer" taklidi — sahte derleyici ve testin kendisi AYNI dosyayı kullanır.
const ASAR_YAZ = path.join(GECICI, 'asar-yaz.mjs');
fs.writeFileSync(ASAR_YAZ, String.raw`
import fs from 'node:fs';
export function asarYaz(yol, dosyalar) {
  const baslik = { files: {} };
  const parcalar = [];
  let ofset = 0;
  for (const [p, icerik] of Object.entries(dosyalar)) {
    const b = Buffer.from(icerik);
    const yp = p.split('/');
    let n = baslik;
    for (const d of yp.slice(0, -1)) n = (n.files[d] = n.files[d] || { files: {} });
    n.files[yp[yp.length - 1]] = { size: b.length, offset: String(ofset) };
    parcalar.push(b);
    ofset += b.length;
  }
  const json = Buffer.from(JSON.stringify(baslik));
  const hizali = (json.length + 3) & ~3;
  const tursu = Buffer.alloc(8 + hizali);
  tursu.writeUInt32LE(4 + hizali, 0);
  tursu.writeUInt32LE(json.length, 4);
  json.copy(tursu, 8);
  const bas = Buffer.alloc(8);
  bas.writeUInt32LE(4, 0);
  bas.writeUInt32LE(tursu.length, 4);
  fs.writeFileSync(yol, Buffer.concat([bas, tursu, ...parcalar]));
}
/** Bir kanalla derlenen panelin asar içeriği: paketin package.json'ı + gömülü kimlik dizeleri (+ panel imza çapası). */
export function gomuluKimlik(k, meta, capa = []) {
  const baslik = k.gorunurEtiket ? k.gorunurEtiket + ' · ' + k.panel.urunAdi : k.panel.urunAdi;
  return {
    'package.json': JSON.stringify(meta),
    'out/main/main.js': 'const appId = "' + k.panel.appId + '"; const updateFeedUrl = "' + k.yayin.panelFeed + '"; const windowTitle = "' + baslik + '";' +
      (capa.length ? ' const panelKunyeTuru = "tekserp-panel"; const anahtarlar = ' + JSON.stringify(capa) + ';' : ''),
    'out/renderer/index.html': '<title>' + baslik + '</title>',
    'out/renderer/assets/index-sahte.js': 'const erpUrl = "' + k.panel.erpAdresi + '"; const label = ' + JSON.stringify(k.gorunurEtiket) + ';',
  };
}
`);
const { asarYaz, gomuluKimlik } = await import(pathToFileURL(ASAR_YAZ).href);
const BIN = path.join(GECICI, 'bin');
fs.mkdirSync(BIN);
for (const arac of ['ssh', 'scp', 'curl', 'git', 'npm', 'npx']) {
  const y = path.join(BIN, arac);
  fs.writeFileSync(y, `#!/bin/sh\nexec "${process.execPath}" "${SAHTE}" ${arac} "$@"\n`);
  fs.chmodSync(y, 0o755);
}

// Satıcı yayın belirteci (3c'): sahte değer, 600 — betikler kenar doğrulamasını yalnız bununla yapar.
const BELIRTEC = path.join(GECICI, 'yayin-belirteci');
fs.writeFileSync(BELIRTEC, `sahte-yayin-belirteci-${'x'.repeat(24)}\n`, { mode: 0o600 });
fs.chmodSync(BELIRTEC, 0o600);

let sayac = 0;
/** Bir senaryo ortamı: kendi sahte uzağı + çağrı günlüğü. */
function ortam() {
  sayac += 1;
  const d = path.join(GECICI, `s${sayac}`);
  const uzak = path.join(d, 'uzak');
  for (const k of ['adnansahin', 'testfabrika']) fs.mkdirSync(path.join(uzak, VDS, 'html', k, 'electron'), { recursive: true });
  const log = path.join(d, 'cagri.jsonl');
  fs.writeFileSync(log, '');
  return {
    d,
    uzak,
    log,
    cagrilar: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s)),
  };
}

function kos(o, komut, argumanlar, { cwd, girdi, ortamEk = {} } = {}) {
  const r = spawnSync(komut, argumanlar, {
    cwd: cwd ?? o.d,
    encoding: 'utf8',
    input: girdi ?? '',
    timeout: 120_000,
    env: {
      ...TEMIZ_ENV,
      PATH: `${BIN}:${process.env.PATH}`,
      SAHTE_UZAK: o.uzak,
      CAGRI_LOG: o.log,
      GERCEK_GIT,
      TEKSERP_YAYIN_BELIRTECI: BELIRTEC,
      // Makinedeki ~/.tekserp/yayin-belirteci-kaynagi.json (CLI kaynağı) dosya belirtecinden ÖNCE okunur;
      // koşum onu görmemeli — yoksa sahte ağaçta gerçek CLI'ı arar (ENOENT) ve 7i–7k düşer.
      TEKSERP_YAYIN_BELIRTEC_KAYNAGI: path.join(GECICI, 'yayin-belirteci-kaynagi-yok.json'),
      GIT_CEILING_DIRECTORIES: GECICI,
      ASAR_YAZ: pathToFileURL(ASAR_YAZ).href,
      KANAL_KAYDI_YEDEK: path.join(KOK, 'deploy/kanallar.json'),
      ...ortamEk,
    },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const agText = (o) => o.cagrilar().filter((c) => c.arac === 'ssh' || c.arac === 'scp');
const yabanciAg = (o) => o.cagrilar().filter((c) => c.YABANCI_AG);
/** Uzağı DEĞİŞTİREBİLEN çağrılar: scp + okuma olmayan her ssh (terfi/denetim okuması `test -f`/`cat` hariç). */
/** Uzak betik okuma mı (yazan komut taşımıyor)? Konumsal argümanlı `bash -s` çağrıları betikten ayırt edilir. */
const betikOkuma = (c) => typeof c.betik === 'string' && !/\b(mkdir|rm|mv|printf|cp|tee)\b|>/.test(c.betik);
const yazanAg = (o) => o.cagrilar().filter((c) => c.arac === 'scp' || (c.arac === 'ssh' && !/^(test -f|cat) '/.test(c.komut) && !betikOkuma(c)));

/* ------------------------------------------------------------------ *
 * Geçici ağaç kopyaları
 * ------------------------------------------------------------------ */

function kopyala(agac, rel, icerik) {
  const hedef = path.join(agac, rel);
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  if (icerik !== undefined) fs.writeFileSync(hedef, icerik);
  else fs.copyFileSync(path.join(KOK, rel), hedef);
}
const gitGoster = (ref, rel) =>
  execFileSync(GERCEK_GIT, ['show', `${ref}:${rel}`], { cwd: KOK, encoding: 'utf8', env: TEMIZ_ENV, stdio: ['ignore', 'pipe', 'ignore'] });

const ORTAK_KAYNAK = [
  'deploy/kanallar.json', 'scripts/lib/kanallar.mjs', 'scripts/kanal-kapisi.mjs', 'scripts/lib/surum.mjs', 'scripts/lib/surum-notu-tavan.mjs',
  'scripts/lib/terfi.mjs', 'scripts/lib/yayin-okuma.mjs', 'scripts/lib/yayin-hedefi.mjs', 'scripts/lib/backend-yayin.mjs',
  ...PANEL_SABIT_DOSYALAR,
  'scripts/lib/yayin-bildirim.mjs',
  'scripts/lib/panel-imza-kapisi.mjs', 'Electron/electron/guncelleme/kunye-jws.mjs', 'Electron/electron/guncelleme/panel-kunye.mjs',
  'Electron/electron/guncelleme/latest-yml.mjs',
];
function agacKur(o, { ref = null, capa = TEST_CAPA } = {}) {
  const agac = path.join(o.d, 'agac');
  for (const rel of [...ORTAK_KAYNAK, 'deploy/electron-yayinla.sh', 'deploy/electron-paketle.sh']) {
    if (ref) {
      try { kopyala(agac, rel, gitGoster(ref, rel)); } catch { /* o ref'te yok (ör. kanallar.json) */ }
    } else kopyala(agac, rel);
  }
  // Etiket girişimi gerçek akıştaki gibi `tag --list`i geçsin diye boş bir depo; `tag -a`yı sahte git keser.
  execFileSync(GERCEK_GIT, ['init', '-q'], { cwd: agac, env: TEMIZ_ENV });
  fs.chmodSync(path.join(agac, 'deploy/electron-yayinla.sh'), 0o755);
  fs.chmodSync(path.join(agac, 'deploy/electron-paketle.sh'), 0o755);
  // Sürüm notu kapısının kendi bekçisi var; burada ölçülen o değil (beyanlı saplama).
  kopyala(agac, 'scripts/check-surum-notlari.mjs', 'process.exit(0);\n');
  // Panel imza çapası: gerçek çapa (karar bekliyor olabilir) yerine bekçinin TEST çapası. İmza aracının
  // çağrıldığı dizin (`Teks-Erp/`) boş durur — sahte `npx` onu koşmaz, kapı imzanın gerçekten yazıldığını ölçer.
  if (!ref) {
    kopyala(agac, PANEL_CAPA_REL, capaMetni(capa));
    fs.mkdirSync(path.join(agac, 'Teks-Erp'), { recursive: true });
  }
  return agac;
}

/**
 * Mobil yayın betiklerinin koştuğu asgari ağaç kopyası (app.json değiştirilebilir) — gerçek ağaca
 * dokunulmadan "ağaç şöyle olsaydı" sorusu için. Sürüm notu kapısı beyanlı saplama.
 */
function mobilAgaci(o, appJsonDegistir = null, { tabletCapa = TEST_CAPA } = {}) {
  sayac += 1;
  const agac = path.join(o.d, `mobil-agac-${sayac}`);
  fs.cpSync(path.join(KOK, 'scripts/lib'), path.join(agac, 'scripts/lib'), { recursive: true });
  fs.cpSync(path.join(KOK, 'mobil/scripts'), path.join(agac, 'mobil/scripts'), { recursive: true });
  for (const rel of ['deploy/kanallar.json', 'deploy/mobil-yayinla.mjs', 'mobil/app.config.js', 'mobil/musteri.json', 'mobil/package.json', 'surum-notlari.json',
    'Electron/electron/guncelleme/kunye-jws.mjs']) kopyala(agac, rel);
  // Tablet imza çapası (gerçeği karar bekliyor olabilir) yerine TEST çapası; kanalların OTA sertifikası yerine SAHTE.
  kopyala(agac, TABLET_CAPA_REL, capaMetni(tabletCapa));
  // İmza aracının çağrıldığı dizin boş durur — sahte `npx` onu koşmaz, kapı imzanın gerçekten yazıldığını ölçer.
  fs.mkdirSync(path.join(agac, 'Teks-Erp'), { recursive: true });
  for (const k of Object.values(JSON.parse(fs.readFileSync(path.join(KOK, 'deploy/kanallar.json'), 'utf8')).kanallar)) {
    kopyala(agac, path.join('mobil', k.tablet.otaSertifika), SERT_KANAL);
  }
  const aj = JSON.parse(fs.readFileSync(path.join(KOK, 'mobil/app.json'), 'utf8'));
  if (appJsonDegistir) appJsonDegistir(aj);
  kopyala(agac, 'mobil/app.json', `${JSON.stringify(aj, null, 2)}\n`);
  kopyala(agac, 'scripts/check-surum-notlari.mjs', 'process.exit(0);\n');
  execFileSync(GERCEK_GIT, ['init', '-q'], { cwd: agac, env: TEMIZ_ENV });
  return agac;
}

/* ------------------------------------------------------------------ *
 * Terfi (K5) hazırlığı — geçici ağaçta GERÇEK git (etiketler bu depoya değil ağaca)
 * ------------------------------------------------------------------ */

const gitGercek = (agac, ...a) => execFileSync(GERCEK_GIT, ['-c', 'user.email=bekci@test', '-c', 'user.name=bekci', ...a],
  { cwd: agac, env: TEMIZ_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ONAY = 'testfabrikada denendi, fabrikaya çıkabilir (kullanıcı onayı, bekçi)';
/**
 * Terfi şartlarını kurar: `<ürün>-v<X>` (HEAD'de ya da bir önceki commit'te) · `terfi/<kod>/<ürün>-v<X>`
 * (açık/hafif/yok, mesajı verilebilir) · kaynak kanalda (testfabrika) yayındaki sürüm (sahte uzakta).
 */
function terfiHazirla(o, agac, { urun = 'panel', surum = '9.9.9', kod = 'adnansahin', kaynakSurum = surum, surumEtiketi = 'HEAD',
  terfiEtiketi = 'acik', mesaj = ONAY } = {}) {
  gitGercek(agac, 'commit', '-q', '--allow-empty', '-m', 'onceki');
  const onceki = gitGercek(agac, 'rev-parse', 'HEAD');
  gitGercek(agac, 'commit', '-q', '--allow-empty', '-m', 'surum');
  if (surumEtiketi) gitGercek(agac, 'tag', '-a', `${urun}-v${surum}`, surumEtiketi === 'onceki' ? onceki : 'HEAD', '-m', `${urun} ${surum}`);
  const te = `terfi/${kod}/${urun}-v${surum}`;
  if (terfiEtiketi === 'acik') gitGercek(agac, 'tag', '-a', te, 'HEAD', '-m', mesaj);
  if (terfiEtiketi === 'hafif') gitGercek(agac, 'tag', te, 'HEAD');
  if (kaynakSurum) {
    const y = urun === 'panel'
      ? [path.join(o.uzak, VDS, 'html/testfabrika/electron/latest.yml'), `version: ${kaynakSurum}\npath: TeksERP-${kaynakSurum}-Setup.exe\n`]
      : [path.join(o.uzak, VDS, 'html/testfabrika/mobil/apk/surum.json'), JSON.stringify({ versionName: kaynakSurum, versionCode: 57 })];
    fs.mkdirSync(path.dirname(y[0]), { recursive: true });
    fs.writeFileSync(y[0], y[1]);
  }
}
/** Terfi kapısının okuduğu tek ağ adresi (panel): kaynak kanalın latest.yml'i. */
const KAYNAK_PANEL_URL = `${YAYIN_HOST}testfabrika/electron/latest.yml`;
// Terfi şartı ③ kaynak kanalı VDS diskinden okur (3c': güncelleme sunucusu anonim okumaya kapalı).
const KAYNAK_OKU = `ssh oku ${VDS}/html/testfabrika/electron/latest.yml`;
const engellenen = (o) => o.cagrilar().filter((c) => c.ENGELLENDI).map((c) => c.ENGELLENDI);

/** Sahte panel derlemesi — electron-builder'ın kimlik taşıyan çıktıları. */
const KAYIT = JSON.parse(fs.readFileSync(path.join(KOK, 'deploy/kanallar.json'), 'utf8'));
const tabletSurum = JSON.parse(fs.readFileSync(path.join(KOK, 'mobil/app.json'), 'utf8')).expo.version;
function panelArtefakti(dizin, { url, cache, exe, surum, ic = 'adnansahin', icMutasyon = null, asarYok = false, kunye = {}, capaGomulu = TEST_CAPA }) {
  const res = path.join(dizin, 'win-unpacked', 'resources');
  fs.mkdirSync(res, { recursive: true });
  if (url) fs.writeFileSync(path.join(res, 'app-update.yml'), `provider: generic\nurl: ${url}\nchannel: latest\nupdaterCacheDirName: ${cache}\n`);
  // Paketin İÇİ (asar): hangi kanalla derlendiyse onun kimliği; `icMutasyon` karışık kimliği kurar.
  if (!asarYok) {
    const k = KAYIT.kanallar[ic];
    const icerik = gomuluKimlik(k, { name: k.panel.paketAdi, productName: k.panel.urunAdi, version: surum }, capaGomulu);
    if (icMutasyon) icMutasyon(icerik);
    asarYaz(path.join(res, 'app.asar'), icerik);
  }
  fs.writeFileSync(path.join(dizin, 'win-unpacked', exe), 'exe');
  const ad = `TeksERP-${surum}-Setup.exe`;
  const govde = crypto.randomBytes(4096);
  fs.writeFileSync(path.join(dizin, ad), govde);
  fs.writeFileSync(path.join(dizin, `${ad}.blockmap`), crypto.randomBytes(256));
  const sha = crypto.createHash('sha512').update(govde).digest('base64');
  fs.writeFileSync(path.join(dizin, 'latest.yml'),
    `version: ${surum}\nfiles:\n  - url: ${ad}\n    sha512: ${sha}\n    size: ${govde.length}\npath: ${ad}\nsha512: ${sha}\n`);
  // Yayın yolu imzalı künye ister (§8): paket varsayılan olarak kendi kanalı için TEST anahtarıyla imzalı doğar.
  if (kunye) kunyeYaz(dizin, { surum, kanal: ic, ...kunye });
}
const ADNANSAHIN_PANEL = { url: `${YAYIN_HOST}adnansahin/electron/`, cache: 'adnan-sahin-erp-admin-updater', exe: 'Adnan Şahin ERP.exe' };
const TESTFABRIKA_PANEL = { url: `${YAYIN_HOST}testfabrika/electron/`, cache: 'teks-erp-testfabrika-updater', exe: 'TeksERP Test Fabrika.exe', ic: 'testfabrika' };
const DEMOFABRIKA_PANEL = { url: `${YAYIN_HOST}demofabrika/electron/`, cache: 'teks-erp-demofabrika-updater', exe: 'TeksERP Demo Fabrika.exe', ic: 'demofabrika' };

/** Uzaktaki dosyalar (yol → sha256) — yüklemenin ETKİSİ. */
function uzakAgaci(o) {
  const cikti = {};
  const gez = (d) => {
    for (const g of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, g.name);
      if (g.isDirectory()) gez(y);
      else cikti[y.slice(o.uzak.length)] = crypto.createHash('sha256').update(fs.readFileSync(y)).digest('hex').slice(0, 12);
    }
  };
  gez(o.uzak);
  return cikti;
}

/** Normalize iz: yayının dünyaya dokunduğu her şey, sırasıyla (zaman/host/sha hariç). */
function iz(o) {
  return o.cagrilar().map((c) => {
    if (c.arac === 'scp') return `scp [${c.kaynaklar.join(', ')}] → ${c.hedef}`;
    if (c.arac === 'ssh' && c.tur === 'budama') return `ssh budama ${c.komut.replace(/^bash -s -- /, '')}`;
    if (c.arac === 'ssh' && typeof c.betik === 'string') {
      const a0 = c.argv?.[0];
      if (/openssl dgst/.test(c.betik)) return `ssh sha512 ${a0}`;
      if (/sha256sum/.test(c.betik)) return `ssh sha256-sorgu ${a0}`;
      if (/>> "\$d"/.test(c.betik)) return `ssh defter ${a0}`;
      if (/mkdir -p -- "\$1"/.test(c.betik)) return `ssh mkdir ${a0}`;
      if (/^(test -f|cat) /.test(c.betik.trim())) return `ssh oku ${a0}`;
      return `ssh ?? ${c.betik.slice(0, 60)}`;
    }
    if (c.arac === 'ssh') {
      if (/sha256sum/.test(c.komut)) return `ssh sha256-sorgu ${/'([^']+)'/.exec(c.komut)?.[1]}`;
      if (/openssl dgst/.test(c.komut)) return `ssh sha512 ${/'([^']+)'/.exec(c.komut)?.[1]}`;
      if (/YAYIN-DEFTERI/.test(c.komut)) return `ssh defter ${/>> '([^']+)'/.exec(c.komut)?.[1]}`;
      if (/^(test -f|cat) '/.test(c.komut)) return `ssh oku ${/'([^']+)'/.exec(c.komut)?.[1]}`;
      return `ssh ?? ${c.komut.slice(0, 60)}`;
    }
    if (c.arac === 'curl') return `curl${c.bas ? ' -I' : ''} ${c.url}`;
    if (c.ENGELLENDI) return `git ${c.ENGELLENDI.replace(/ -m .*/, '')} (engellendi)`;
    if (c.YABANCI_AG) return `YABANCI AĞ ${c.YABANCI_AG}`;
    return `${c.arac} ${c.args ?? ''}`.trim();
  }).filter((s) => !/^git (rev-parse|tag --list|rev-list)/.test(s));
}

/* ------------------------------------------------------------------ *
 * §1 electron-yayinla.sh
 * ------------------------------------------------------------------ */

console.log('\n§1 — electron-yayinla.sh: hedef paketin kimliğinden, ssh\'tan ÖNCE');

// `--eski=<ref>`: ref'teki yayıncı `--musteri` biliyor mu (D1+) — bilmiyorsa argümansız + release/<sürüm> düzeni.
const ESKI_KANALLI = ESKI ? gitGoster(ESKI, 'deploy/electron-yayinla.sh').includes('--musteri=') : false;

function yayinSenaryosu({ ref = null, musteriArg = '--musteri=adnansahin', artefakt = ADNANSAHIN_PANEL, dizin = 'adnansahin', surum = '9.9.9', ekArg = [],
  terfi, mutasyon = null, ortamEk = {} } = {}) {
  const o = ortam();
  const agac = agacKur(o, { ref });
  // Bugünden sonra adnansahin'e yayın terfi şartı ister: varsayılan senaryo şartları KURAR (yeni betik, adnansahin);
  // eski ref'te kurulmaz (bugünkü akışın etiketsiz hâli). `terfi: false` = hiç kurma, nesne = seçenekler.
  const kur = terfi === undefined ? (!ref && musteriArg === '--musteri=adnansahin' ? {} : null) : terfi || null;
  if (kur) terfiHazirla(o, agac, { surum, ...kur });
  if (mutasyon) {
    const y = path.join(agac, 'deploy/electron-yayinla.sh');
    const once = fs.readFileSync(y, 'utf8');
    const sonra = mutasyon(once);
    if (sonra === once) throw new Error('yayinla mutasyonu UYGULANMADI — sonda geçersiz');
    fs.writeFileSync(y, sonra);
  }
  const rel = ref && !ESKI_KANALLI ? path.join(agac, 'Electron/release', surum) : path.join(agac, 'Electron/release', dizin, surum);
  if (artefakt) panelArtefakti(rel, { ...artefakt, surum });
  const args = [musteriArg, surum, ...ekArg].filter(Boolean);
  const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), args, { cwd: agac, ortamEk });
  return { o, r, agac };
}

{
  const { o, r } = yayinSenaryosu();
  const u = uzakAgaci(o);
  const kok = `${VDS}/html/adnansahin/electron`;
  const sirali = iz(o);
  const scpIz = sirali.filter((s) => s.startsWith('scp'));
  ol('1a adnansahin paketi --musteri=adnansahin → çıkış 0', r.kod === 0, r.cikti.slice(-600));
  ol('1a yükleme yalnız …/html/adnansahin/electron/ — önce exe+blockmap, EN SON latest.yml',
    scpIz.length === 2 &&
      scpIz[0] === `scp [TeksERP-9.9.9-Setup.exe, TeksERP-9.9.9-Setup.exe.blockmap] → ${kok}/` &&
      scpIz[1] === `scp [latest.yml] → ${kok}/`, scpIz.join('\n'));
  // Kurulumun koyduğu kaynak kanal latest.yml'i (terfi şartı ③) yüklemenin etkisi değildir.
  const KAYNAK_YML = `${VDS}/html/testfabrika/electron/latest.yml`;
  const yuklenen = (agacU) => Object.keys(agacU).filter((k) => k !== KAYNAK_YML);
  ol('1a uzakta üç dosya, başka kanala tek bayt yok',
    yuklenen(u).filter((k) => k.includes('/html/')).sort().join(',') ===
      [`${kok}/TeksERP-9.9.9-Setup.exe`, `${kok}/TeksERP-9.9.9-Setup.exe.blockmap`, `${kok}/latest.yml`].join(','),
    Object.keys(u).join('\n'));
  ol('1a yayın defteri adnansahin-YAYIN-DEFTERI.tsv (html/ DIŞINDA)', Object.keys(u).includes(`${VDS}/defter/adnansahin-YAYIN-DEFTERI.tsv`));
  // Terfi akışında panel-vX testfabrika yayınında atılmıştır: adnansahin yayını yeni sürüm etiketi ATMAZ.
  ol('1a sha512 sunucuda doğrulandı + budama; sürüm etiketi zaten var (testfabrika turundan) → yeni etiket girişimi YOK',
    sirali.includes(`ssh sha512 ${kok}/TeksERP-9.9.9-Setup.exe`) && sirali.some((s) => s.startsWith(`ssh budama ${kok} 9.9.9`)) &&
      engellenen(o).length === 0 && /sürüm etiketi zaten var: panel-v9\.9\.9/.test(r.cikti), sirali.join('\n'));
  ol('1a terfi kapısı geçti: HEAD == panel-v9.9.9 · terfi etiketi · testfabrika 9.9.9 (VDS diskinden, yükleme ssh/scp\'sinden ÖNCE okundu)',
    /✓ terfi kapısı: panel 9\.9\.9 → adnansahin/.test(r.cikti) && sirali.indexOf(KAYNAK_OKU) >= 0 &&
      sirali.indexOf(KAYNAK_OKU) < sirali.findIndex((s) => (s.startsWith('ssh') || s.startsWith('scp')) && s !== KAYNAK_OKU), r.cikti.slice(0, 900));
  ol('1a ağ: HTTP yalnız yayın sunucusunun adnansahin yolu; terfi kapısının TEK okuması SSH ile (testfabrika latest.yml), HTTP ile DEĞİL', yabanciAg(o).length === 0 &&
    o.cagrilar().filter((c) => c.arac === 'curl').every((c) => c.url.startsWith(`${YAYIN_HOST}adnansahin/electron/`)) &&
    sirali.filter((x) => x === KAYNAK_OKU).length === 1, sirali.join('\n'));
  const curller = o.cagrilar().filter((c) => c.arac === 'curl');
  ol('1a ⭐ kenar doğrulaması BELİRTEÇLİ: her curl X-TKL-Indirme başlığını taşır (anonim HTTP okuma SIFIR)',
    curller.length >= 4 && curller.every((c) => c.belirtec === true), JSON.stringify(curller.slice(0, 3)));
  ol('1a belirteç değeri çıktıya DÜŞMEZ', !r.cikti.includes('sahte-yayin-belirteci-'), r.cikti.slice(-300));

  if (ESKI) {
    // FARK ÖLÇÜMÜ: bugünkü (eski) betik terfi şartsız, etiketsiz ağaçtan; yeni betik terfi şartlı ağaçtan.
    // Beklenen ve İZİN VERİLEN fark YALNIZ terfi adımıdır: + kaynak kanal okuması · − sürüm etiketi girişimi
    // (etiket testfabrika turunda atılmış olur). Başka her satır birebir aynı olmalı.
    const e = yayinSenaryosu({ ref: ESKI, musteriArg: ESKI_KANALLI ? '--musteri=adnansahin' : null });
    const izEski = iz(e.o);
    const izYeni = iz(o);
    const TERFI_EK = KAYNAK_OKU;
    const TERFI_EKSIK = 'git tag -a panel-v9.9.9 (engellendi)';
    const eklenen = izYeni.filter((s) => !izEski.includes(s));
    const eksilen = izEski.filter((s) => !izYeni.includes(s));
    const ortakEski = izEski.filter((s) => s !== TERFI_EKSIK);
    const ortakYeni = izYeni.filter((s) => s !== TERFI_EK);
    const fark = ortakEski.length !== ortakYeni.length ? ['uzunluk'] : ortakEski.filter((s, i) => s !== ortakYeni[i]);
    ol(`1a⇄${ESKI} ESKİ betik ile YENİ betik aynı izi bırakır — tek fark TERFİ adımı (+ ${TERFI_EK} · − ${TERFI_EKSIK})`,
      e.r.kod === 0 && fark.length === 0 && eklenen.join('|') === TERFI_EK && eksilen.join('|') === TERFI_EKSIK,
      `eski çıkış ${e.r.kod}\neklenen: ${eklenen.join(' | ')}\neksilen: ${eksilen.join(' | ')}\nESKİ:\n${izEski.join('\n')}\nYENİ:\n${izYeni.join('\n')}`);
    console.log(`   ⇄ adnansahin panel yayını, ${ESKI} → bu dilim: eklenen [${eklenen.join(' | ')}] · eksilen [${eksilen.join(' | ')}] · ortak ${ortakYeni.length} satır birebir`);
    const uE = Object.keys(uzakAgaci(e.o)).sort();
    ol(`1a⇄${ESKI} uzaktaki dosya kümesi aynı`, uE.join(',') === yuklenen(u).sort().join(','), `${uE.join('\n')}\n--\n${yuklenen(u).sort().join('\n')}`);
  }
}

{
  // B3: testfabrika derlemesi adnansahin klasöründe kalmış (ya da oraya kopyalanmış), niyet adnansahin.
  const { o, r } = yayinSenaryosu({ artefakt: TESTFABRIKA_PANEL, dizin: 'adnansahin' });
  ol('1b testfabrika paketi + --musteri=adnansahin → DUR, ssh/scp SIFIR',
    r.kod !== 0 && agText(o).length === 0 && /testfabrika/.test(r.cikti), r.cikti.slice(-500));
  if (ESKI && !ESKI_KANALLI) {
    // GEREKÇE ÖLÇÜMÜ (kapı gerekli mi): eski betik aynı paketi ne yapıyordu?
    const e = yayinSenaryosu({ ref: ESKI, musteriArg: null, artefakt: TESTFABRIKA_PANEL });
    const yuklenen = e.o.cagrilar().filter((c) => c.arac === 'scp').map((c) => c.hedef);
    ol(`1b⇄${ESKI} ESKİ betik testfabrika paketini adnansahin klasörüne YÜKLÜYORDU (B3 ölçüldü — kapının gerekçesi)`,
      yuklenen.length === 2 && yuklenen.every((h) => h === `${VDS}/html/adnansahin/electron/`), `${e.r.kod}\n${yuklenen.join('\n')}`);
  }
}
{
  const { o, r } = yayinSenaryosu({ musteriArg: null });
  ol('1c --musteri yok → DUR, ssh/scp SIFIR', r.kod !== 0 && agText(o).length === 0 && /--musteri=<kod> zorunlu/.test(r.cikti), r.cikti);
}
{
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=testfabirka', dizin: 'testfabirka' });
  ol('1d bilinmeyen kanal (testfabirka) → DUR, ssh/scp SIFIR', r.kod !== 0 && agText(o).length === 0 && /BİLİNMEYEN KANAL/.test(r.cikti), r.cikti);
}
{
  const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, cache: 'teks-erp-testfabrika-updater' } });
  ol('1e updater önbelleği başka kanalın → DUR, ssh/scp SIFIR', r.kod !== 0 && agText(o).length === 0 && /updaterCacheDirName/.test(r.cikti), r.cikti);
}
{
  const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, url: null } });
  ol('1f app-update.yml yok → ÖLÇÜLEMEDİ, ssh/scp SIFIR', r.kod !== 0 && agText(o).length === 0 && /ÖLÇÜLEMEDİ/.test(r.cikti), r.cikti);
}
{
  const o = ortam();
  const agac = agacKur(o);
  panelArtefakti(path.join(agac, 'Electron/release/9.9.9'), { ...ADNANSAHIN_PANEL, surum: '9.9.9' });
  const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '9.9.9'], { cwd: agac });
  ol('1g eski düzen release/<sürüm> → DUR (sessizce eski klasörü yüklemez)', r.kod !== 0 && agText(o).length === 0 && /ESKİ düzende/.test(r.cikti), r.cikti);
}
{
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=testfabrika', artefakt: TESTFABRIKA_PANEL, dizin: 'testfabrika' });
  const kok = `${VDS}/html/testfabrika/electron`;
  const hedefler = o.cagrilar().filter((c) => c.arac === 'scp').map((c) => c.hedef);
  ol('1h testfabrika paketi + --musteri=testfabrika → yalnız …/html/testfabrika/electron/ + testfabrika defteri',
    r.kod === 0 && hedefler.length === 2 && hedefler.every((h) => h === `${kok}/`) &&
      Object.keys(uzakAgaci(o)).includes(`${VDS}/defter/testfabrika-YAYIN-DEFTERI.tsv`) &&
      !Object.keys(uzakAgaci(o)).some((k) => k.includes('/adnansahin/')), `${r.cikti.slice(-400)}\n${hedefler.join('\n')}`);
}
{
  const o = ortam();
  const agac = agacKur(o);
  panelArtefakti(path.join(o.uzak, VDS, 'html/adnansahin/electron'), { ...ADNANSAHIN_PANEL, surum: '9.9.8' });
  const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '--dogrula'], { cwd: agac });
  const izI = iz(o);
  ol('1i --dogrula (salt denetim) → çıkış 0, scp SIFIR, ssh yalnız latest.yml OKUMASI (VDS diski), kenar curl\'leri belirteçli',
    r.kod === 0 && /OK — yayında: 9\.9\.8/.test(r.cikti) &&
      izI.filter((x) => x.startsWith('ssh') || x.startsWith('scp')).join('|') === `ssh oku ${VDS}/html/adnansahin/electron/latest.yml` &&
      o.cagrilar().filter((c) => c.arac === 'curl').every((c) => c.belirtec === true), `${izI.join('\n')}\n${r.cikti.slice(-400)}`);
}
const agSifir = (o) => o.cagrilar().filter((c) => ['ssh', 'scp', 'curl'].includes(c.arac) || c.ENGELLENDI).length === 0;
{
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=testfabrika', artefakt: TESTFABRIKA_PANEL, dizin: 'testfabrika', ekArg: ['--kuru'] });
  ol('1j --kuru: testfabrika paketi + --musteri=testfabrika → KABUL (çıkış 0), ssh/scp/curl/etiket SIFIR, plan testfabrika klasörü',
    r.kod === 0 && agSifir(o) && /KURU — paket 'testfabrika' kanalının/.test(r.cikti) && r.cikti.includes(`${VDS}/html/testfabrika/electron/`),
    r.cikti.slice(-600));
}
{
  const { o, r } = yayinSenaryosu({ artefakt: TESTFABRIKA_PANEL, dizin: 'adnansahin', ekArg: ['--kuru'] });
  ol('1k --kuru: aynı testfabrika paketi + --musteri=adnansahin → DUR, ağ SIFIR', r.kod !== 0 && agSifir(o) && /KANALININ DEĞİL/.test(r.cikti), r.cikti.slice(-500));
}
{
  const { o, r } = yayinSenaryosu({ ekArg: ['--kuru', '--dogrula'] });
  ol('1l --kuru ile --dogrula birlikte → DUR (biri ağa bakar, öbürü hiç çıkmaz)', r.kod !== 0 && agSifir(o) && /birlikte verilemez/.test(r.cikti), r.cikti.slice(-300));
}
// 3c' — YAYIN BELİRTECİ: yoksa/gevşekse/biçimsizse hiçbir ağ/ssh işinden ÖNCE dur; anonim okumaya DÜŞME.
const belirtecDosyasi = (o, icerik, mod = 0o600) => {
  const y = path.join(o.d, `belirtec-${mod.toString(8)}`);
  fs.writeFileSync(y, icerik, { mode: mod });
  fs.chmodSync(y, mod);
  return y;
};
const belirtecSenaryosu = (hazirla, ekArg = []) => {
  const o = ortam();
  const agac = agacKur(o);
  terfiHazirla(o, agac, { surum: '9.9.9' });
  panelArtefakti(path.join(agac, 'Electron/release/adnansahin/9.9.9'), { ...ADNANSAHIN_PANEL, surum: '9.9.9' });
  const yol = hazirla(o);
  const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '9.9.9', ...ekArg], { cwd: agac, ortamEk: { TEKSERP_YAYIN_BELIRTECI: yol } });
  return { o, r };
};
{
  const { o, r } = belirtecSenaryosu((x) => path.join(x.d, 'olmayan-belirtec'));
  ol('1s ⭐ belirteç YOK → DUR (çıkış≠0), ssh/scp/curl SIFIR, TR hata dosya yolunu söyler, anonim okumaya DÜŞMEZ',
    r.kod !== 0 && agSifir(o) && /YAYIN BELİRTECİ YOK/.test(r.cikti) && /hiçbir şey yüklenmedi/.test(r.cikti), r.cikti.slice(-600));
}
{
  const { o, r } = belirtecSenaryosu((x) => belirtecDosyasi(x, `sahte-yayin-belirteci-${'y'.repeat(24)}\n`, 0o644));
  ol('1t belirteç izinleri GEVŞEK (644) → DUR, ağ SIFIR, değer çıktıya düşmez',
    r.kod !== 0 && agSifir(o) && /İZİNLERİ GEVŞEK/.test(r.cikti) && !r.cikti.includes('yyyyyyyy'), r.cikti.slice(-500));
}
{
  const { o, r } = belirtecSenaryosu((x) => belirtecDosyasi(x, 'iki satir\nbaslik-enjeksiyonu: x\n'));
  ol('1u belirteç BİÇİMSİZ (boşluk/çok satır — başlık enjeksiyonu) → DUR, ağ SIFIR', r.kod !== 0 && agSifir(o) && /BİÇİMSİZ/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const agac = agacKur(o);
  panelArtefakti(path.join(o.uzak, VDS, 'html/adnansahin/electron'), { ...ADNANSAHIN_PANEL, surum: '9.9.8' });
  const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '--dogrula'], { cwd: agac, ortamEk: { TEKSERP_YAYIN_BELIRTECI: path.join(o.d, 'yok') } });
  ol('1v --dogrula belirteçsiz → DUR, ağ SIFIR (anonim denetime düşmez)', r.kod !== 0 && agSifir(o) && /YAYIN BELİRTECİ YOK/.test(r.cikti), r.cikti.slice(-400));
}
{
  const o2 = ortam();
  const agac = agacKur(o2);
  panelArtefakti(path.join(agac, 'Electron/release/testfabrika/9.9.9'), { ...TESTFABRIKA_PANEL, surum: '9.9.9' });
  const r2 = kos(o2, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=testfabrika', '9.9.9', '--kuru'], { cwd: agac, ortamEk: { TEKSERP_YAYIN_BELIRTECI: path.join(o2.d, 'yok') } });
  ol('1w --kuru belirteç İSTEMEZ (ağa çıkmaz): belirteçsiz de KABUL, ağ SIFIR', r2.kod === 0 && agSifir(o2), r2.cikti.slice(-400));
}
{
  // ⭐ SONDA: yayıncıdan belirteç başlığı sökülünce kenar curl'leri anonim gider — 1a'nın belirteç ölçümü bunu görmeli.
  const { o, r } = yayinSenaryosu({ mutasyon: (m) => m.replace('curl -H "@$BELIRTEC_BASLIK" "$@"', 'curl "$@"') });
  const curller = o.cagrilar().filter((c) => c.arac === 'curl');
  ol('1x ⭐ SONDA: belirteç başlığı sökülünce yayın yine geçer ama curl\'ler ANONİM — 1a ölçümü (every belirtec) KIRMIZI verirdi',
    r.kod === 0 && curller.length >= 4 && curller.every((c) => c.belirtec === false), JSON.stringify(curller.slice(0, 2)));
}
{
  // Paketin İÇİ başka kanalın: productName → userData dizini (aynı makinede iki kanal aynı veriyi paylaşır).
  const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, icMutasyon: (ic) => {
    const pk = JSON.parse(ic['package.json']);
    pk.productName = 'TeksERP Test Fabrika';
    ic['package.json'] = JSON.stringify(pk);
  } } });
  ol('1m paketin package.json productName (userData) başka kanalın → DUR, ssh/scp SIFIR', r.kod !== 0 && agText(o).length === 0 && /productName/.test(r.cikti), r.cikti.slice(-500));
}
{
  // app-update.yml + exe fabrikanın, ama ana süreç (AUMID · çalışma anı adresi) testfabrika ile derlenmiş.
  const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, icMutasyon: (ic) => {
    ic['out/main/main.js'] = gomuluKimlik(KAYIT.kanallar.testfabrika, {})['out/main/main.js'];
  } } });
  ol('1n ana süreç başka kanalın AUMID/adresini taşıyor (karışık derleme) → DUR, ssh/scp SIFIR',
    r.kod !== 0 && agText(o).length === 0 && /ana süreç/.test(r.cikti) && /testfabrika/.test(r.cikti), r.cikti.slice(-600));
}
{
  const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, asarYok: true } });
  ol('1o paket arşivi (app.asar) yok → ÖLÇÜLEMEDİ, ssh/scp SIFIR', r.kod !== 0 && agText(o).length === 0 && /ÖLÇÜLEMEDİ/.test(r.cikti), r.cikti.slice(-300));
}
// G22/DAGY-4 — hedef YALNIZ kayıttan: ortamda kalmış her ezme (eski SSH_HEDEF/UZAK_DIZIN/YAYIN_KOK/YAYIN_URL/BASE_URL)
// testfabrika (terfi istemeyen) yayınını ağdan ÖNCE durdurur — eskiden paket başka kanalın dizinine inerdi.
for (const [ad, deger] of [['UZAK_DIZIN', `${VDS}/html/adnansahin/electron`], ['SSH_HEDEF', 'baska-sunucu'], ['YAYIN_KOK', `${VDS}/html`],
  ['YAYIN_URL', `${YAYIN_HOST}adnansahin/electron`], ['BASE_URL', 'https://guncelleme.etkiliyazilim.com']]) {
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=testfabrika', artefakt: TESTFABRIKA_PANEL, dizin: 'testfabrika', ortamEk: { [ad]: deger } });
  ol(`1y ⭐ ortamda ${ad} ezmesi (testfabrika yayını) → DUR, ssh/scp/curl SIFIR, hiçbir dosya yüklenmez`,
    r.kod !== 0 && /YAYIN HEDEFİ EZİLEMEZ/.test(r.cikti) && r.cikti.includes(`ortam ${ad}`) && agSifir(o) &&
      !Object.keys(uzakAgaci(o)).some((k) => /TeksERP-9\.9\.9/.test(k)), r.cikti.slice(-500));
}
{
  // Pozitif ikiz: ezme kaldırılınca aynı paket kayıttaki hedefe yayınlanır (hedef kaydın vdsPanel'i).
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=testfabrika', artefakt: TESTFABRIKA_PANEL, dizin: 'testfabrika', ortamEk: { UZAK_DIZIN: '' } });
  const hedefler = o.cagrilar().filter((c) => c.arac === 'scp').map((c) => c.hedef);
  ol('1y2 boş UZAK_DIZIN (ezme yok) → yayın kayıttaki hedefe: yalnız testfabrika vdsPanel/',
    r.kod === 0 && hedefler.length === 2 && hedefler.every((h) => h === `${KAYIT.kanallar.testfabrika.yayin.vdsPanel}/`), `${r.cikti.slice(-300)}\n${hedefler.join('\n')}`);
}
{
  // Hedef çözümü — kuru, demofabrika (aynasız hazırlık): VDS dizini + defter + doğrulama adresi KAYITTAN.
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=demofabrika', artefakt: DEMOFABRIKA_PANEL, dizin: 'demofabrika', ekArg: ['--kuru'] });
  const y = KAYIT.kanallar.demofabrika.yayin;
  ol('1y3 demofabrika --kuru → hedef, defter ve yayın adresi kanal kaydından (vdsPanel · panelDefter · panelFeed), ağ SIFIR',
    r.kod === 0 && r.cikti.includes(`[kuru] hedef      : tekserp-yayin:${y.vdsPanel}/`) && r.cikti.includes(`[kuru] defter     : ${y.panelDefter}`) &&
      r.cikti.includes(`[kuru] yayın adresi: ${y.panelFeed}latest.yml`) && agSifir(o), r.cikti.slice(-600));
}
{
  // DAGY-9: sürüm uzak komutlara gider → biçim dışı sürüm (kabuk karakteri) ağdan ÖNCE durur.
  const { o, r } = yayinSenaryosu({ musteriArg: '--musteri=testfabrika', artefakt: null, dizin: 'testfabrika', surum: "9.9.9';id;'" });
  ol('1z ⭐ biçimsiz sürüm argümanı (kabuk karakteri) → DUR, ssh/scp/curl SIFIR', r.kod !== 0 && /Sürüm biçimsiz/.test(r.cikti) && agSifir(o), r.cikti.slice(-400));
}

/* ------------------------------------------------------------------ *
 * §2 electron-paketle.sh (sahte derleyici)
 * ------------------------------------------------------------------ */

console.log('\n§2 — electron-paketle.sh: dosya yazmadan kanal kapısı, kimlik derleme anında, çıktı kanala ayrık');

// Dinlenme dosyaları (panel kimliğinin ağaçtaki izleri + kayıt): paketleme bunlara DOKUNMAZ.
const IZLENEN = [...PANEL_SABIT_DOSYALAR, 'deploy/kanallar.json'];
const ozet = (agac) => IZLENEN.map((rel) => {
  const y = path.join(agac, rel);
  return fs.existsSync(y) ? crypto.createHash('sha256').update(fs.readFileSync(y)).digest('hex') : 'yok';
}).join(',');
const SURUM = JSON.parse(fs.readFileSync(path.join(KOK, 'Electron/package.json'), 'utf8')).version;

function paketleSenaryosu(argumanlar, { ref = null, mutasyon = null, agacMutasyon = null, terfi } = {}) {
  const o = ortam();
  const agac = agacKur(o, { ref });
  // adnansahin paketlemesi bugünden sonra terfi şartı ister: yeni betikte varsayılan KURULUR (bkz. yayinSenaryosu).
  const kur = terfi === undefined ? (!ref && argumanlar[0] === 'adnansahin' ? {} : null) : terfi || null;
  if (kur) terfiHazirla(o, agac, { surum: argumanlar[1] ?? SURUM, ...kur });
  if (agacMutasyon) agacMutasyon(agac);
  if (mutasyon) {
    const y = path.join(agac, 'deploy/electron-paketle.sh');
    const once = fs.readFileSync(y, 'utf8');
    const sonra = mutasyon(once);
    if (sonra === once) throw new Error('paketle mutasyonu UYGULANMADI — sonda geçersiz');
    fs.writeFileSync(y, sonra);
  }
  const once = ozet(agac);
  const r = kos(o, path.join(agac, 'deploy/electron-paketle.sh'), argumanlar, { cwd: agac });
  return { o, r, agac, once, sonra: ozet(agac) };
}
/** Derlenen paketin kimliği — yayıncının okuduğu yüklemle aynı kaynaktan (asar dahil). */
function derlenen(agac, kod, surum = SURUM) {
  const dizin = path.join(agac, 'Electron/release', kod, surum);
  const res = path.join(dizin, 'win-unpacked/resources');
  if (!fs.existsSync(path.join(res, 'app.asar'))) return null;
  const ic = asarOku(path.join(res, 'app.asar'), () => true);
  return {
    yml: fs.readFileSync(path.join(res, 'app-update.yml'), 'utf8'),
    exeler: fs.readdirSync(path.join(dizin, 'win-unpacked')).filter((f) => f.endsWith('.exe')),
    paket: JSON.parse(ic['package.json'].toString('utf8')),
    main: ic['out/main/main.js'].toString('utf8'),
    arayuz: ic['out/renderer/assets/index-sahte.js'].toString('utf8'),
    baslik: ic['out/renderer/index.html'].toString('utf8'),
  };
}
const npmCagrisi = (o) => o.cagrilar().find((c) => c.arac === 'npm' && /^run build:win/.test(c.args));
{
  const s = paketleSenaryosu(['testfabirka', SURUM]);
  ol('2a bilinmeyen kanal → DUR, dinlenme dosyaları DEĞİŞMEDİ, derleme YOK',
    s.r.kod !== 0 && s.once === s.sonra && !s.o.cagrilar().some((c) => c.arac === 'npm') && /BİLİNMEYEN KANAL/.test(s.r.cikti), s.r.cikti);
}
{
  const s = paketleSenaryosu(['testfabrika', SURUM]);
  const d = derlenen(s.agac, 'testfabrika');
  const n = npmCagrisi(s.o);
  ol(`2b testfabrika ${SURUM} → çıkış 0, çıktı release/testfabrika/${SURUM}/`, s.r.kod === 0 && d !== null, s.r.cikti.slice(-700));
  ol('2b dinlenme dosyaları BAYT BAYT aynı (kimlik ağaca yazılmadı: package.json · musteri.json · main.ts · index.html · …)', s.once === s.sonra);
  ol('2b derleyici iki bacağı da aldı: TEKSERP_KANAL=testfabrika + electron-builder -c.* (appId · ürün adı · paket adı · adres)',
    n?.kanal === 'testfabrika' && n.args.includes('-c.appId=com.etkiliyazilim.teks-erp.testfabrika') &&
      n.args.includes('-c.extraMetadata.name=teks-erp-testfabrika') && n.args.includes(`-c.publish.url=${YAYIN_HOST}testfabrika/electron/`),
    JSON.stringify(n));
  ol('2b paket kimliği testfabrika: adres · updater önbelleği · "TeksERP Test Fabrika.exe" · paketin package.json · AUMID · varsayılan sunucu · etiket',
    d !== null && d.yml.includes(`url: ${YAYIN_HOST}testfabrika/electron/`) && d.yml.includes('updaterCacheDirName: teks-erp-testfabrika-updater') &&
      d.exeler.join() === 'TeksERP Test Fabrika.exe' && d.paket.name === 'teks-erp-testfabrika' && d.paket.productName === 'TeksERP Test Fabrika' &&
      d.main.includes('"com.etkiliyazilim.teks-erp.testfabrika"') && d.arayuz.includes('"http://100.70.47.46:4000"') && d.arayuz.includes('"TEST FABRİKA"') &&
      !d.main.includes('adnan-sahin') && !d.arayuz.includes('192.168.1.250'), JSON.stringify(d)?.slice(0, 600));
  ol('2b yayın komutu önerisi --musteri=testfabrika taşıyor', /electron-yayinla\.sh --musteri=testfabrika/.test(s.r.cikti));
}
{
  const s = paketleSenaryosu(['adnansahin', SURUM]);
  const d = derlenen(s.agac, 'adnansahin');
  const n = npmCagrisi(s.o);
  const p = JSON.parse(fs.readFileSync(path.join(KOK, 'Electron/package.json'), 'utf8'));
  ol(`2c adnansahin ${SURUM} → çıkış 0, çıktı release/adnansahin/${SURUM}/`, s.r.kod === 0 && d !== null, s.r.cikti.slice(-600));
  ol('2c dinlenme dosyaları BAYT BAYT aynı kaldı (adnansahin için sıfır fark)', s.once === s.sonra);
  ol('2c gömülü kimlik bugünkü: url …/adnansahin/electron/ · adnan-sahin-erp-admin-updater · "Adnan Şahin ERP.exe" · paketin package.json · AUMID',
    d !== null && d.yml.includes(`url: ${YAYIN_HOST}adnansahin/electron/`) && d.yml.includes('updaterCacheDirName: adnan-sahin-erp-admin-updater') &&
      d.exeler.join() === 'Adnan Şahin ERP.exe' && d.paket.name === 'adnan-sahin-erp-admin' && d.paket.productName === 'Adnan Şahin ERP' &&
      d.main.includes('"com.etkiliyazilim.adnan-sahin-erp"') && d.arayuz.includes('"http://192.168.1.250:4000"') && d.arayuz.includes('const label = null'));
  // Enjekte edilen değerler ağaçtaki tabanla birebir: varsayilan kanal için ezme bir şey DEĞİŞTİRMEZ.
  const ayar = panelDerlemeAyarlari('adnansahin', kanalCoz('adnansahin').kanal);
  const taban = {
    appId: p.build.appId, productName: p.build.productName, 'extraMetadata.name': p.name, 'extraMetadata.productName': p.productName,
    'extraMetadata.description': p.description, 'nsis.shortcutName': p.build.nsis.shortcutName,
    'nsis.uninstallDisplayName': p.build.nsis.uninstallDisplayName, 'publish.url': p.build.publish[0].url, 'directories.output': p.build.directories.output,
  };
  ol('2c ⭐ adnansahin için enjekte edilen HER kimlik değeri package.json tabanıyla birebir (ezme = no-op)',
    JSON.stringify(ayar) === JSON.stringify(taban) && n?.kanal === 'adnansahin', `${JSON.stringify(ayar)}\n${JSON.stringify(taban)}`);
  ol('2c yayın komutu önerisi --musteri taşıyor', /electron-yayinla\.sh --musteri=adnansahin/.test(s.r.cikti));
  if (ESKI) {
    const e = paketleSenaryosu(['adnansahin', SURUM], { ref: ESKI });
    const eKok = [path.join(e.agac, 'Electron/release/adnansahin', SURUM), path.join(e.agac, 'Electron/release', SURUM)].find((y) => fs.existsSync(y));
    const eYml = eKok ? path.join(eKok, 'win-unpacked/resources/app-update.yml') : '';
    const yml = path.join(s.agac, 'Electron/release/adnansahin', SURUM, 'win-unpacked/resources/app-update.yml');
    ol(`2c⇄${ESKI} ESKİ paketleme aynı gömülü kimliği üretir (app-update.yml birebir, exe adı aynı, paketin package.json'ı aynı)`,
      e.r.kod === 0 && Boolean(eKok) && fs.readFileSync(eYml, 'utf8') === fs.readFileSync(yml, 'utf8') &&
        fs.readdirSync(path.join(eKok, 'win-unpacked')).join() === fs.readdirSync(path.dirname(path.dirname(yml))).join() &&
        asarOku(path.join(eKok, 'win-unpacked/resources/app.asar'), (x) => x === 'package.json')['package.json'].equals(
          asarOku(path.join(path.dirname(yml), 'app.asar'), (x) => x === 'package.json')['package.json']),
      e.r.cikti.slice(-400));
    const pE = JSON.parse(fs.readFileSync(path.join(e.agac, 'Electron/package.json'), 'utf8'));
    const pY = JSON.parse(fs.readFileSync(path.join(s.agac, 'Electron/package.json'), 'utf8'));
    pE.build.directories.output = pY.build.directories.output = '<ayrık>';
    ol(`2c⇄${ESKI} paketlemeden sonra package.json çıktı dizini DIŞINDA birebir`, JSON.stringify(pE) === JSON.stringify(pY));
  }
}
{
  // SONDA: enjeksiyonun electron-builder bacağı düşerse paket tabanın (adnansahin) kimliğiyle doğar.
  const s = paketleSenaryosu(['testfabrika', SURUM], { mutasyon: (m) => m.replaceAll(' -- "${derleme_argumanlari[@]}"', '') });
  ol('2d ⭐ SONDA: electron-builder -c.* argümanları düşerse → derleme sonrası kapı DURDURUR (karışık kimlik yayına çıkamaz)',
    s.r.kod !== 0 && Boolean(npmCagrisi(s.o)) && /PAKET YANLIŞ MÜŞTERİYİ GÖSTERİYOR|KANALININ DEĞİL|bulunamadı/.test(s.r.cikti) && s.once === s.sonra,
    s.r.cikti.slice(-500));
}
{
  // SONDA: electron-vite bacağı düşerse app-update.yml doğru ama ana süreç başka kanalın AUMID/adresini taşır.
  const s = paketleSenaryosu(['testfabrika', SURUM], { mutasyon: (m) => m.replaceAll('TEKSERP_KANAL="$musteri" npm run', 'npm run') });
  ol('2e ⭐ SONDA: TEKSERP_KANAL (kod içi kimlik) düşerse → derleme sonrası kapı ana süreçteki yabancı kimliği yakalar',
    s.r.kod !== 0 && Boolean(npmCagrisi(s.o)) && /ana süreç/.test(s.r.cikti) && /adnansahin/.test(s.r.cikti), s.r.cikti.slice(-600));
}
{
  // Kaynak literal kimlik taşıyorsa enjeksiyon onu göremez: kapı HİÇBİR ŞEY yazmadan ve derlemeden önce durur.
  const s = paketleSenaryosu(['testfabrika', SURUM], { agacMutasyon: (agac) => {
    const y = path.join(agac, 'Electron/electron/main.ts');
    const m = fs.readFileSync(y, 'utf8');
    const yeni = m.replace('setAppUserModelId(APP_ID)', 'setAppUserModelId("com.etkiliyazilim.adnan-sahin-erp")');
    if (yeni === m) throw new Error('main.ts mutasyonu UYGULANMADI — sonda geçersiz');
    fs.writeFileSync(y, yeni);
  } });
  ol('2f kaynakta literal AUMID (kanaldan değil) → paketleme kanal kapısında DURUR, derleme YOK, dosya yazılmadı',
    s.r.kod !== 0 && !s.o.cagrilar().some((c) => c.arac === 'npm') && /PAKETLENEMEZ/.test(s.r.cikti) && s.once === s.sonra, s.r.cikti.slice(0, 600));
}

/* ------------------------------------------------------------------ *
 * §3 mobil-yayinla.mjs (--kuru, gerçek ağaç)
 * ------------------------------------------------------------------ */

console.log('\n§3 — mobil-yayinla.mjs: ERP adresi kanalın adresi mi (OTA + APK)');

function otaPaketi(o, { adres = FABRIKA_ERP, bundleAdres = FABRIKA_ERP, kanal = 'adnansahin', bundleYok = false, ekAdres = null, imzali = true,
  capaGomulu = TEST_CAPA } = {}) {
  const damga = '1790000000000';
  const d = path.join(o.d, 'ota', kanal, '54.2', damga);
  const bundle = '_expo/static/js/android/index-sahte.hbc';
  fs.mkdirSync(path.join(d, path.dirname(bundle)), { recursive: true });
  if (!bundleYok) fs.writeFileSync(path.join(d, bundle), `\x00\x01hermes${bundleAdres}\x00${ekAdres ?? ''}${capaDizeleri(capaGomulu)}\x00son`, 'latin1');
  const kunye = { musteri: kanal, runtimeVersion: '54.2', damga, bundle, manifestId: 'sahte-id', imzali };
  if (adres !== undefined) kunye.adres = adres;
  fs.writeFileSync(path.join(d, 'yayin.json'), JSON.stringify(kunye));
  // extra.expoClient.version: yayıncı paketin sürümünü (terfi + etiket) donmuş manifestten okur.
  const man = `{"id":"sahte-id","launchAsset":{"url":"${YAYIN_HOST}${kanal}/mobil/ota/54.2/${damga}/${bundle}"},"extra":{"expoClient":{"version":"${tabletSurum}"}}}`;
  fs.writeFileSync(path.join(d, 'manifest'), man);
  fs.writeFileSync(path.join(d, `manifest-${damga}`), man);
  return d;
}
const mobilYayinla = (o, args, agac = KOK) => kos(o, process.execPath, [path.join(agac, 'deploy/mobil-yayinla.mjs'), ...args, '--kuru'], { cwd: agac });
/** adnansahin tablet yayını terfi şartı ister: şartları kurulmuş kopya ağaç (gerçek ağacın etiketlerine dokunulmaz). */
function tabletTerfiAgaci(o, { tabletCapa, ...secenek } = {}) {
  const agac = mobilAgaci(o, null, tabletCapa ? { tabletCapa } : {});
  terfiHazirla(o, agac, { urun: 'tablet', surum: tabletSurum, ...secenek });
  return agac;
}
const etiketGirisimi = (o) => o.cagrilar().some((c) => c.ENGELLENDI);

{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`], tabletTerfiAgaci(o));
  ol('3a adnansahin OTA (künye + bundle fabrika adresi, terfi etiketli ağaç) --kuru → çıkış 0', r.kod === 0 && /ERP adresi {5}: http:\/\/192\.168\.1\.250:4000\/api/.test(r.cikti), r.cikti.slice(-600));
  ol('3a --kuru etiket ATMAZ (git tag/push girişimi yok)', !etiketGirisimi(o) && /\[kuru\] sürüm etiketi atılmadı/.test(r.cikti));
  ol('3a --kuru hiçbir şeyi gerçekten yüklemez (ssh/scp çağrısı yok) ve kaynak kanalı okumaz (ağ yok)',
    agText(o).length === 0 && !o.cagrilar().some((c) => c.arac === 'curl') && /ÖLÇÜLMEDİ \(kuru kip/.test(r.cikti), r.cikti.slice(-600));
}
{
  // 3c' — yayın belirteci: kuru OLMAYAN yayın ve --dogrula belirteçsiz DURUR (yüklemeden ÖNCE; anonim okumaya düşmez).
  const o = ortam();
  const yok = { TEKSERP_YAYIN_BELIRTECI: path.join(o.d, 'olmayan-belirtec') };
  const paketTf = otaPaketi(o, { kanal: 'testfabrika', adres: TEST_ERP, bundleAdres: TEST_ERP });
  const r = kos(o, process.execPath, [path.join(KOK, 'deploy/mobil-yayinla.mjs'), '--musteri=testfabrika', `--paket=${paketTf}`], { cwd: KOK, ortamEk: yok });
  ol('3s ⭐ testfabrika OTA (kuru DEĞİL) belirteçsiz → DUR, ssh/scp/curl SIFIR, TR hata',
    r.kod !== 0 && /YAYIN BELİRTECİ YOK/.test(r.cikti) && agSifir(o), r.cikti.slice(-600));
  const d = kos(o, process.execPath, [path.join(KOK, 'deploy/mobil-yayinla.mjs'), '--dogrula=https://127.0.0.1:9/testfabrika/mobil/apk/surum.json'], { cwd: KOK, ortamEk: yok });
  ol('3t --dogrula belirteçsiz → DUR (anonim denetime düşmez)', d.kod !== 0 && /YAYIN BELİRTECİ YOK/.test(d.cikti), d.cikti.slice(-400));
}
{
  // Terfi (K5) tablet: git şartları kuru kipte de ölçülür.
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`], tabletTerfiAgaci(o, { terfiEtiketi: null }));
  ol(`3o adnansahin OTA, terfi/adnansahin/tablet-v${tabletSurum} YOK → DUR (kuru kipte de), ssh/scp SIFIR`,
    r.kod !== 0 && /TERFİ KAPISI/.test(r.cikti) && /onay etiketi YOK/.test(r.cikti) && agText(o).length === 0, r.cikti.slice(-700));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`], tabletTerfiAgaci(o, { surumEtiketi: 'onceki' }));
  ol(`3p adnansahin OTA, HEAD ≠ tablet-v${tabletSurum} → DUR`, r.kod !== 0 && /HEAD \([0-9a-f]+\) ≠ tablet-v/.test(r.cikti) && agText(o).length === 0, r.cikti.slice(-700));
}
{
  const o = ortam();
  const cumle = "fabrika tabletleri açılmıyor, acil düzeltmeyi test'siz gönder";
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`, `--terfi-atla=${cumle}`], tabletTerfiAgaci(o, { terfiEtiketi: null, surumEtiketi: null, kaynakSurum: null }));
  ol('3q --terfi-atla="<cümle>" (etiketsiz ağaç) → geçer; defter satırı cümleyi taşır; kuru: etiket yok',
    r.kod === 0 && /TERFİ KAPISI ATLANDI/.test(r.cikti) && r.cikti.includes('terfi-atlandi: fabrika tabletleri') &&
      r.cikti.includes('tablet-' + tabletSurum) && !etiketGirisimi(o) && agText(o).length === 0, r.cikti.slice(-900));
  const r2 = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`, '--terfi-atla=acil'], tabletTerfiAgaci(o, { terfiEtiketi: null }));
  ol('3r --terfi-atla="acil" (kısa cümle) → DUR', r2.kod !== 0 && /REDDEDİLDİ: cümle KISA/.test(r2.cikti), r2.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { adres: TEST_ERP })}`]);
  ol('3b künye adresi testfabrika sunucusu + --musteri=adnansahin → DUR (B6)', r.kod !== 0 && /BAŞKA BİR ERP SUNUCUSUNA BAĞLI/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { adres: undefined, bundleAdres: TEST_ERP })}`]);
  ol('3c künyede adres yok, bundle testfabrika sunucusu → DUR (otorite bundle)', r.kod !== 0 && /BU KANALIN ERP ADRESİNİ TAŞIMIYOR/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { bundleYok: true })}`]);
  ol('3d bundle okunamıyor → ÖLÇÜLEMEDİ, DUR', r.kod !== 0 && /ÖLÇÜLEMEDİ/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { ekAdres: TEST_ERP })}`]);
  ol('3e bundle fabrika adresinin YANINDA başka sayısal-IP sunucu → DUR', r.kod !== 0 && /BAŞKA BİR SUNUCU ADRESİ DE VAR/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=testfabirka', `--paket=${otaPaketi(o)}`]);
  ol('3f bilinmeyen kanal → DUR', r.kod !== 0 && /BİLİNMEYEN KANAL/.test(r.cikti), r.cikti.slice(-400));
}
// G22/DAGY-4 — tablet yayın hedefi YALNIZ kayıttan: argüman ya da ortam ezmesi HER kipte (kuru · denetim dahil) durur.
{
  const tfPaket = (o) => otaPaketi(o, { kanal: 'testfabrika', adres: TEST_ERP, bundleAdres: TEST_ERP });
  for (const ezme of ['--feed=https://guncelleme.etkiliyazilim.com/adnansahin/mobil/', `--uzak-dizin=${VDS}/html/adnansahin/mobil`, '--ssh=baska-sunucu']) {
    const o = ortam();
    const r = mobilYayinla(o, ['--musteri=testfabrika', `--paket=${tfPaket(o)}`, ezme]);
    ol(`3z ⭐ ${ezme.split('=')[0]} ezmesi (testfabrika OTA) → DUR, ağ SIFIR`, r.kod !== 0 && /YAYIN HEDEFİ EZİLEMEZ/.test(r.cikti) && agSifir(o), r.cikti.slice(-400));
  }
  for (const ad of ['UZAK_DIZIN', 'YAYIN_URL', 'SSH_HEDEF']) {
    const o = ortam();
    const r = kos(o, process.execPath, [path.join(KOK, 'deploy/mobil-yayinla.mjs'), '--musteri=testfabrika', `--paket=${tfPaket(o)}`, '--kuru'],
      { cwd: KOK, ortamEk: { [ad]: ad === 'SSH_HEDEF' ? 'baska-sunucu' : `${VDS}/html/adnansahin/mobil` } });
    ol(`3z2 ortamda ${ad} (testfabrika OTA) → DUR, ağ SIFIR`, r.kod !== 0 && r.cikti.includes(`ortam ${ad}`) && agSifir(o), r.cikti.slice(-400));
  }
  const o = ortam();
  const d = kos(o, process.execPath, [path.join(KOK, 'deploy/mobil-yayinla.mjs'), `--dogrula=${YAYIN_HOST}testfabrika/mobil/apk/surum.json`], { cwd: KOK, ortamEk: { YAYIN_URL: 'https://x.ornek' } });
  ol('3z3 denetim kipi (--dogrula) de ezmeyi reddeder', d.kod !== 0 && /YAYIN HEDEFİ EZİLEMEZ/.test(d.cikti), d.cikti.slice(-300));
}
{
  // DAGY-9: künyedeki damga uzak yola girer — kabuk karakterli damga hiçbir şey göndermeden durur.
  const o = ortam();
  const dz = otaPaketi(o, { kanal: 'testfabrika', adres: TEST_ERP, bundleAdres: TEST_ERP });
  const k = JSON.parse(fs.readFileSync(path.join(dz, 'yayin.json'), 'utf8'));
  fs.writeFileSync(path.join(dz, 'yayin.json'), JSON.stringify({ ...k, damga: "1790000000000';id;'" }));
  const r = mobilYayinla(o, ['--musteri=testfabrika', `--paket=${dz}`]);
  ol('3z4 ⭐ künye damgası biçimsiz (kabuk karakteri) → DUR, ağ SIFIR', r.kod !== 0 && /Paket künyesi biçimsiz/.test(r.cikti) && agSifir(o), r.cikti.slice(-400));
}

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
function axmlYaz({ paket, meta = {} }) {
  const NS = 'http://schemas.android.com/apk/res/android';
  const YOK = 0xffffffff;
  const dizeler = [];
  const no = (x) => {
    let i = dizeler.indexOf(x);
    if (i < 0) i = dizeler.push(x) - 1;
    return i;
  };
  const ogeler = [{ ad: 'manifest', oz: paket == null ? [] : [{ ns: null, ad: 'package', deger: paket }] }];
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
function apk(o, { feed = `${YAYIN_HOST}adnansahin/mobil/`, erp = FABRIKA_ERP, bundleYok = false, manifestUrlYok = false,
  paket = 'com.teks.erp.mobil', manifestBozuk = false, sertifikaPem = null, appConfig = null, capaGomulu = TEST_CAPA } = {}) {
  sayac += 1;
  const y = path.join(o.d, `sahte-${sayac}.apk`);
  const meta = { 'expo.modules.updates.ENABLED': 'true' };
  if (!manifestUrlYok) meta['expo.modules.updates.EXPO_UPDATE_URL'] = `${feed}ota/54.2/manifest`;
  if (sertifikaPem) meta['expo.modules.updates.CODE_SIGNING_CERTIFICATE'] = sertifikaPem;
  const man = manifestBozuk ? Buffer.from('<manifest>duz metin</manifest>') : axmlYaz({ paket, meta });
  const g = [{ ad: 'AndroidManifest.xml', veri: man, yontem: 8 }];
  if (!bundleYok) g.push({ ad: 'assets/index.android.bundle', veri: Buffer.from(`hermes\u0000${erp}${capaDizeleri(capaGomulu)}\u0000son`, 'latin1'), yontem: 0 });
  if (appConfig) g.push({ ad: 'assets/app.config', veri: Buffer.from(JSON.stringify(appConfig)), yontem: 8 });
  zipYaz(y, g);
  return y;
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { sertifikaPem: SERT_KANAL })}`, `--surum=${tabletSurum}`, '--vc=57'], tabletTerfiAgaci(o));
  ol(`3g adnansahin APK (manifest + bundle fabrika, terfi etiketli ağaç) --kuru --surum=${tabletSurum} → çıkış 0, etiket yok`,
    r.kod === 0 && /APK içindeki adres: https:\/\/guncelleme\.etkiliyazilim\.com\/adnansahin\/mobil\/ota\/54\.2\/manifest/.test(r.cikti) &&
      /✓ terfi kapısı: tablet/.test(r.cikti) && !etiketGirisimi(o) && agText(o).length === 0 &&
      /OTA sertifikası: kanalınkiyle aynı/.test(r.cikti) && /tablet çapası {2}: panel-2099 — pakette gömülü/.test(r.cikti) &&
      /\[kuru\] künye {3}: İMZASIZ — gerçek yayında imzalanır/.test(r.cikti), r.cikti.slice(-900));
  const r2 = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { sertifikaPem: SERT_KANAL })}`, `--surum=${tabletSurum}`, '--vc=57'], tabletTerfiAgaci(o, { terfiEtiketi: 'hafif' }));
  ol('3g2 adnansahin APK, terfi etiketi HAFİF (onay cümlesi/saat taşımaz) → DUR', r2.kod !== 0 && /AÇIKLAMALI değil/.test(r2.cikti) && agText(o).length === 0, r2.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { erp: TEST_ERP })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3h APK bundle testfabrika sunucusu + --musteri=adnansahin → DUR (not kapısından da ÖNCE)',
    r.kod !== 0 && /BU KANALIN ERP ADRESİNİ TAŞIMIYOR/.test(r.cikti) && !/Sürüm notu|SÜRÜM NOTU/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { bundleYok: true })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3i APK içinde bundle yok → ÖLÇÜLEMEDİ, DUR', r.kod !== 0 && /ÖLÇÜLEMEDİ — APK içindeki JS bundle/.test(r.cikti), r.cikti.slice(-400));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { manifestUrlYok: true })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3j APK manifesti güncelleme adresi taşımıyor → ÖLÇÜLEMEDİ, DUR (eskiden uyarı + devam)', r.kod !== 0 && /ÖLÇÜLEMEDİ — APK içindeki güncelleme adresi/.test(r.cikti), r.cikti.slice(-400));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { feed: `${YAYIN_HOST}testfabrika/mobil/` })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3k APK güncelleme adresi testfabrika + --musteri=adnansahin → DUR', r.kod !== 0 && /YANLIŞ GÜNCELLEME ADRESİNİ/.test(r.cikti), r.cikti.slice(-400));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { paket: 'com.teks.erp.mobil.testfabrika' })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3l APK paket adı testfabrika (adres + bundle fabrikanın) + --musteri=adnansahin → DUR (B5, not kapısından ÖNCE)',
    r.kod !== 0 && /APK BAŞKA BİR UYGULAMANIN PAKETİ/.test(r.cikti) && /"testfabrika" kanalının/.test(r.cikti) && !/SÜRÜM NOTU/.test(r.cikti), r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o, { manifestBozuk: true })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3m APK manifesti ikili XML değil → ÖLÇÜLEMEDİ (paket adı), DUR', r.kod !== 0 && /ÖLÇÜLEMEDİ — APK paket adı okunamadı/.test(r.cikti), r.cikti.slice(-400));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=testfabrika', `--apk=${apk(o, { paket: 'com.teks.erp.mobil', feed: `${YAYIN_HOST}testfabrika/mobil/`, erp: TEST_ERP })}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol('3n fabrika paket adlı APK (adres + bundle testfabrika) + --musteri=testfabrika → DUR (fabrika uygulamasının ÜSTÜNE yazardı)',
    r.kod !== 0 && /APK BAŞKA BİR UYGULAMANIN PAKETİ/.test(r.cikti) && /"adnansahin" kanalının/.test(r.cikti), r.cikti.slice(-500));
}

/* ------------------------------------------------------------------ *
 * §3G6 — tablet APK künyesi: imzasız künye/OTA yüklenmez, sertifika + çapa + rotasyon kapıları
 * ------------------------------------------------------------------ */
console.log('\n§3G6 — tablet APK künyesi (G6) + DAGY-6 kapıları');

/** APK'nın yanına (mobil-yayinla'nın künye yolu) imzalı surum.json — bekçinin TEST anahtarıyla. */
function apkKunyesi(apkYol, { anahtar = IMZA, kanal = 'adnansahin', vc = 57, surum = tabletSurum, capa = TEST_CAPA.map((k) => k.kid) } = {}) {
  const govde = fs.readFileSync(apkYol);
  const sha256 = crypto.createHash('sha256').update(govde).digest('hex');
  const ad = apkDosyaAdi(surum, vc);
  const doc = buildApkDoc({ kanal, versionCode: vc, versionName: surum, commit: 'abcdef0', yayinZamani: '2026-10-01T01:00:00.000Z',
    paket: { ad, boyut: govde.length, sha256 }, capa });
  const s = withApkBlock({ versionCode: vc, versionName: surum, dosya: ad, sha256, boyut: govde.length }, signApkDoc({ doc, kid: anahtar.kid, privateKey: anahtar.privateKey }));
  const yol = path.join(path.dirname(apkYol), 'surum.json');
  fs.writeFileSync(yol, JSON.stringify(s, null, 2));
  return yol;
}
/**
 * Kuru OLMAYAN yayın (yalnız yüklemeden önce duran kapılar ölçülür). Doğrulama okuması ağa ÇIKMAZ: süreç önüne yüklenen
 * sahte `fetch` bağlantı reddi verir (eskiden `--feed=127.0.0.1:9` ezmesiyle yapılırdı — ezme artık yükleyiciyi durdurur).
 */
const SAHTE_FETCH_KOPUK = path.join(GECICI, 'sahte-fetch-kopuk.mjs');
fs.writeFileSync(SAHTE_FETCH_KOPUK, `import fs from 'node:fs';
globalThis.fetch = async (u) => {
  fs.appendFileSync(process.env.CAGRI_LOG, JSON.stringify({ arac: 'fetch', url: String(u).split('?')[0] }) + '\\n');
  throw new TypeError('fetch failed (sahte: bağlantı reddi)');
};
`);
const mobilYayinlaGercek = (o, args, agac) =>
  kos(o, process.execPath, ['--import', pathToFileURL(SAHTE_FETCH_KOPUK).href, path.join(agac, 'deploy/mobil-yayinla.mjs'), ...args], { cwd: agac });
const apkArg = (o, sec = {}) => [`--apk=${apk(o, { sertifikaPem: SERT_KANAL, ...sec })}`, `--surum=${tabletSurum}`, '--vc=57'];

{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { imzali: false })}`], tabletTerfiAgaci(o));
  ol('3u ⭐ İMZASIZ OTA paketi (yayin.json imzali:false) → DUR (eskiden yalnız uyarı), ssh/scp SIFIR',
    r.kod !== 0 && /OTA PAKETİ İMZASIZ — yüklenmez/.test(r.cikti) && agText(o).length === 0, r.cikti.slice(-500));
}
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { capaGomulu: [] })}`], tabletTerfiAgaci(o));
  ol('3v OTA bundle ağacın tablet çapasını taşımıyor (bayat paket) → DUR', r.kod !== 0 && /PAKET AĞACIN TABLET İMZA ÇAPASINI TAŞIMIYOR/.test(r.cikti) && /eksik {2}: panel-2099/.test(r.cikti), r.cikti.slice(-500));
  const r2 = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o, { capaGomulu: [] })}`], tabletTerfiAgaci(o, { tabletCapa: [] }));
  ol('3w ağacın tablet çapası BOŞ (anahtar kararı bekliyor) → OTA UYARI ile geçer (OTA kanalı ayrı; APK güncellemesi çapalı OTA ile açılır)',
    r2.kod === 0 && /apk-imza-capasi\.json BOŞ/.test(r2.cikti) && /OTA kanalı etkilenmez/.test(r2.cikti), r2.cikti.slice(-600));
  const r3 = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`], tabletTerfiAgaci(o, { tabletCapa: [{ kid: 'paket-hazirlik-1', x: IMZA.x }] }));
  ol('3x tablet çapasında hazırlık anahtarı → DUR (GEÇERSİZ)', r3.kod !== 0 && /TABLET İMZA ÇAPASI GEÇERSİZ/.test(r3.cikti), r3.cikti.slice(-500));
}
{
  const o = ortam();
  const agac = tabletTerfiAgaci(o);
  const yok = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o)}`, `--surum=${tabletSurum}`, '--vc=57'], agac);
  ol('3y ⭐ APK OTA kod imzası sertifikası TAŞIMIYOR (elle derleme) → DUR (DAGY-6), ssh/scp SIFIR',
    yok.kod !== 0 && /SERTİFİKASINI TAŞIMIYOR/.test(yok.cikti) && /sertifika YOK/.test(yok.cikti) && agText(o).length === 0, yok.cikti.slice(-500));
  const yabanci = mobilYayinla(o, ['--musteri=adnansahin', ...apkArg(o, { sertifikaPem: SERT_YABANCI })], agac);
  ol('3y2 APK BAŞKA bir sertifika taşıyor → DUR', yabanci.kod !== 0 && /SERTİFİKASINI TAŞIMIYOR/.test(yabanci.cikti) && /başka bir sertifika/.test(yabanci.cikti), yabanci.cikti.slice(-500));
  const crlf = mobilYayinla(o, ['--musteri=adnansahin', ...apkArg(o, { sertifikaPem: SERT_KANAL.replaceAll('\n', '\r\n') })], agac);
  ol('3y3 pozitif: aynı sertifika farklı satır sonuyla (CRLF) → kimlik farkı DEĞİL, geçer', crlf.kod === 0 && /OTA sertifikası: kanalınkiyle aynı/.test(crlf.cikti), crlf.cikti.slice(-500));
}
{
  const o = ortam();
  const bos = mobilYayinla(o, ['--musteri=adnansahin', ...apkArg(o)], tabletTerfiAgaci(o, { tabletCapa: [] }));
  ol('3z ⭐ tablet çapası BOŞ → APK yayınlanmaz (imzalı künye yazılamaz), ssh/scp SIFIR',
    bos.kod !== 0 && /TABLET İMZA ÇAPASI BOŞ — APK yayınlanmaz/.test(bos.cikti) && agText(o).length === 0, bos.cikti.slice(-500));
  const bayat = mobilYayinla(o, ['--musteri=adnansahin', ...apkArg(o, { capaGomulu: [] })], tabletTerfiAgaci(o));
  ol('3z2 APK bundle ağacın tablet çapasını taşımıyor → DUR', bayat.kod !== 0 && /TABLET İMZA ÇAPASINI TAŞIMIYOR/.test(bayat.cikti), bayat.cikti.slice(-500));
}
{
  const o = ortam();
  const agac = tabletTerfiAgaci(o);
  const a = apkArg(o);
  apkKunyesi(a[0].slice('--apk='.length));
  const r = mobilYayinla(o, ['--musteri=adnansahin', ...a], agac);
  ol('3G1 APK yanında BU APK\'nın geçerli imzalı künyesi → kuru: "imzalı · kid panel-2099", ssh/scp SIFIR',
    r.kod === 0 && /künye {10}: imzalı · kid panel-2099/.test(r.cikti) && agText(o).length === 0, r.cikti.slice(-600));
  const b = apkArg(o);
  apkKunyesi(b[0].slice('--apk='.length), { kanal: 'testfabrika' });
  const r2 = mobilYayinla(o, ['--musteri=adnansahin', ...b], agac);
  ol('3G2 yanındaki künye BAŞKA kanalın → bu yayın için geçersiz sayılır (yeniden imza gerekir; kuru: İMZASIZ)',
    r2.kod === 0 && /\[kuru\] künye {3}: İMZASIZ/.test(r2.cikti), r2.cikti.slice(-500));
}
{
  // Kuru OLMAYAN: imzasız künye hiçbir koşulda yüklenmez (yükleme öncesi DUR).
  const o = ortam();
  const agac = tabletTerfiAgaci(o);
  const r = mobilYayinlaGercek(o, ['--musteri=adnansahin', ...apkArg(o)], agac);
  ol('3G3 ⭐ kuru DEĞİL, künye İMZASIZ ve anahtar yok → DUR, uzağı değiştiren çağrı SIFIR',
    r.kod !== 0 && /APK KÜNYESİ İMZASIZ ve imza anahtarı verilmedi/.test(r.cikti) && yazanAg(o).length === 0, r.cikti.slice(-600));
  const r2 = mobilYayinlaGercek(o, ['--musteri=adnansahin', ...apkArg(o), `--anahtar=${path.join(o.d, 'anahtar.json')}`], agac);
  const imzaci = o.cagrilar().find((c) => c.arac === 'npx' && /panel-imza\.ts apk-imzala --musteri=adnansahin/.test(c.args ?? ''));
  ol('3G4 ⭐ anahtar verildi ama imza aracı imzalamadı (sahte npx) → "kapıdan geçmedi" DUR, uzağı değiştiren çağrı SIFIR',
    r2.kod !== 0 && !!imzaci && /İmzalanan künye kapıdan geçmedi/.test(r2.cikti) && yazanAg(o).length === 0, r2.cikti.slice(-600));
}
{
  // Rotasyon kilidi: yayındaki künye yalnız panel-2098'i tanıyor; panel-2099 ile imzalı APK yüklenmez.
  const o = ortam();
  const agac = tabletTerfiAgaci(o, { tabletCapa: [...TEST_CAPA, { kid: IMZA_ONCEKI.kid, x: IMZA_ONCEKI.x }] });
  const uzakApk = path.join(o.uzak, VDS, 'html/adnansahin/mobil/apk');
  fs.mkdirSync(uzakApk, { recursive: true });
  const eski = apk(o, { sertifikaPem: SERT_KANAL });
  fs.copyFileSync(apkKunyesi(eski, { anahtar: IMZA_ONCEKI, vc: 56, capa: [IMZA_ONCEKI.kid] }), path.join(uzakApk, 'surum.json'));
  const a = apkArg(o, { capaGomulu: [...TEST_CAPA, { kid: IMZA_ONCEKI.kid, x: IMZA_ONCEKI.x }] });
  apkKunyesi(a[0].slice('--apk='.length), { capa: [IMZA.kid, IMZA_ONCEKI.kid] });
  const r = mobilYayinlaGercek(o, ['--musteri=adnansahin', ...a], agac);
  ol('3G5 ⭐ ROTASYON: yayındaki tabletler yalnız panel-2098\'i tanır, yeni APK panel-2099 imzalı → DUR, scp SIFIR',
    r.kod !== 0 && /ROTASYON KİLİDİ/.test(r.cikti) && /panel-2099 ile imzalanan APK'yı KURMAZLAR/.test(r.cikti) && o.cagrilar().every((c) => c.arac !== 'scp'), r.cikti.slice(-600));
  // Yayındaki künyesiz (geçiş: eski tablet) → ilk imzalı APK yüklenir; sıra APK → surum.json (EN SON) ve yüklenen künye imzalı.
  fs.writeFileSync(path.join(uzakApk, 'surum.json'), JSON.stringify({ versionCode: 56, versionName: '1.0.0', dosya: 'TeksERP-1.0.0-vc56.apk' }));
  const o2Oncesi = o.cagrilar().length;
  const r2 = mobilYayinlaGercek(o, ['--musteri=adnansahin', ...a], agac);
  const scpler = o.cagrilar().slice(o2Oncesi).filter((c) => c.arac === 'scp').map((c) => c.kaynaklar.join(','));
  const yuklenen = JSON.parse(fs.readFileSync(path.join(uzakApk, 'surum.json'), 'utf8'));
  ol('3G6 ⭐ yayındaki künyesiz (eski tablet) → ilk imzalı APK YÜKLENİR: önce APK, EN SON imzalı surum.json',
    /künyesiz \(imza denetlemeyen tablet\)/.test(r2.cikti) && scpler.length === 2 && /\.apk$/.test(scpler[0]) && scpler[1] === 'surum.json' &&
      typeof yuklenen.tekserp?.bildirim === 'string' && yuklenen.versionCode === 57, `${scpler.join(' → ')}\n${r2.cikti.slice(-500)}`);
}

/* ------------------------------------------------------------------ *
 * §4 yayinla-ota.mjs --check (ağsız argümanlarla)
 * ------------------------------------------------------------------ */

console.log('\n§4 — yayinla-ota.mjs: ERP adresi ağdan ÖNCE kanalla kıyaslanır');

// Ağ yok: sürüm elle (etiket/yayın okuması atlanır), künye adresi 127.0.0.1:9 (bağlantı reddi).
// adnansahin terfi şartı ister: şartları kurulmuş kopya ağaçta (kaynak testfabrika künyesi sahte uzakta).
const otaCheck = (o, apiUrl, { terfi = {}, ek = [], ortamEk = {} } = {}) => {
  const agac = terfi ? tabletTerfiAgaci(o, terfi) : mobilAgaci(o);
  return kos(o, process.execPath, [path.join(agac, 'mobil/scripts/yayinla-ota.mjs'),
    '--musteri=adnansahin', `--api-url=${apiUrl}`, '--check', `--surum=${tabletSurum}`, '--update-url=http://127.0.0.1:9/', ...ek],
  { cwd: path.join(agac, 'mobil'), ortamEk });
};
{
  const o = ortam();
  const r = otaCheck(o, FABRIKA_ERP);
  ol('4a fabrika adresi + --musteri=adnansahin (terfi etiketli ağaç) → kanal + terfi kapısı geçer, ön kontrol TAMAM',
    r.kod === 0 && /Kanal {13}: adnansahin \(uretim\)/.test(r.cikti) && !/KANALININ DEĞİL/.test(r.cikti) &&
      /✓ terfi kapısı: tablet/.test(r.cikti) && /③ testfabrika: tablet APK künyesi/.test(r.cikti), r.cikti.slice(-900));
}
{
  // Terfi (K5) tablet paket üreticisi — üç şartın her biri ve ÖLÇÜLEMEDİ, app.json'a yazmadan önce.
  const o = ortam();
  const geride = otaCheck(o, FABRIKA_ERP, { terfi: { kaynakSurum: '0.0.1' } });
  ol('4i kaynak kanal (testfabrika) GERİDE → DUR', geride.kod !== 0 && /testfabrika kanalı GERİDE/.test(geride.cikti) && !/Native parmak izi/.test(geride.cikti), geride.cikti.slice(-600));
  const yok = otaCheck(o, FABRIKA_ERP, { terfi: { kaynakSurum: null } });
  ol('4j kaynak kanalda hiç yayın yok (404) → DUR (ihlal, ölçülemedi DEĞİL)', yok.kod !== 0 && /GERİDE — .*yayın yok/.test(yok.cikti), yok.cikti.slice(-600));
  const kopuk = otaCheck(o, FABRIKA_ERP, { ortamEk: { SAHTE_SSH_KOPUK: '/testfabrika/' } });
  ol('4k kaynak kanal OKUNAMIYOR (bağlantı reddi) → ÖLÇÜLEMEDİ, DUR', kopuk.kod !== 0 && /TERFİ KAPISI ÖLÇÜLEMEDİ/.test(kopuk.cikti) && /OKUNAMADI/.test(kopuk.cikti), kopuk.cikti.slice(-600));
  const etiketsiz = otaCheck(o, FABRIKA_ERP, { terfi: { terfiEtiketi: null, surumEtiketi: null } });
  ol('4l etiketsiz ağaç (bugünkü main ucu) + --musteri=adnansahin → DUR (tablet-vX yok · onay etiketi yok)',
    etiketsiz.kod !== 0 && /tablet-v[\d.]+ etiketi YOK/.test(etiketsiz.cikti) && /onay etiketi YOK/.test(etiketsiz.cikti), etiketsiz.cikti.slice(-600));
  const kisa = otaCheck(o, FABRIKA_ERP, { terfi: { mesaj: 'tamam' } });
  ol('4m terfi etiketi mesajı onay cümlesi taşımıyor ("tamam") → DUR', kisa.kod !== 0 && /mesajı onay cümlesini taşımıyor/.test(kisa.cikti), kisa.cikti.slice(-500));
  const bos = otaCheck(o, FABRIKA_ERP, { terfi: { terfiEtiketi: null }, ek: ['--terfi-atla='] });
  ol('4o --terfi-atla= (BOŞ cümle) → DUR', bos.kod !== 0 && /REDDEDİLDİ: cümle BOŞ/.test(bos.cikti), bos.cikti.slice(-400));
}
{
  const o = ortam();
  const atla = otaCheck(o, FABRIKA_ERP, { terfi: { terfiEtiketi: null, surumEtiketi: null, kaynakSurum: null }, ek: ['--terfi-atla=fabrika çöktü, test turu beklemeden düzeltmeyi çıkar'] });
  ol('4n --terfi-atla="<cümle>" etiketsiz ağaçta → terfi ATLANDI, ön kontrol TAMAM, kaynak kanal okunmadı',
    atla.kod === 0 && /TERFİ KAPISI ATLANDI/.test(atla.cikti) && !o.cagrilar().some((c) => (c.arac === 'curl' && c.url.includes('/testfabrika/')) || (c.arac === 'ssh' && String(c.komut).includes('/testfabrika/'))), atla.cikti.slice(-600));
}
{
  const o = ortam();
  const r = otaCheck(o, `${FABRIKA_ERP}/`);
  ol('4b sondaki / farkı aynı adres sayılır', /Kanal {13}: adnansahin/.test(r.cikti), r.cikti.slice(0, 500));
}
{
  const o = ortam();
  const r = otaCheck(o, TEST_ERP);
  ol('4c testfabrika adresi + --musteri=adnansahin → DUR (B6: üretim artık mümkün değil)',
    r.kod !== 0 && /ERP ADRESİ "adnansahin" KANALININ DEĞİL/.test(r.cikti) && !/Uygulama sürümü/.test(r.cikti), r.cikti.slice(-500));
}
const otaCheckKanal = (o, kod, ekArg = [], { cwd = path.join(KOK, 'mobil'), ortamEk = {} } = {}) => kos(o, process.execPath, [path.join(cwd, 'scripts/yayinla-ota.mjs'),
  `--musteri=${kod}`, '--check', `--surum=${tabletSurum}`, '--update-url=http://127.0.0.1:9/', ...ekArg], { cwd, ortamEk });
const parmakIzi = (cikti) => /Native parmak izi : ([0-9a-f]+)/.exec(cikti)?.[1] ?? null;
{
  const o = ortam();
  const a = otaCheck(o, FABRIKA_ERP);
  const t = otaCheckKanal(o, 'testfabrika', [`--api-url=${TEST_ERP}`]);
  ol('4d testfabrika adresi + --musteri=testfabrika → kanal kapısı geçer (kimlik app.config.js\'ten, app.json\'a dokunmadan)',
    t.kod === 0 && /Kanal {13}: testfabrika \(hazirlik\)/.test(t.cikti), t.cikti.slice(0, 900));
  ol('4d native parmak izi kanaldan BAĞIMSIZ (adnansahin = testfabrika)',
    parmakIzi(a.cikti) !== null && parmakIzi(a.cikti) === parmakIzi(t.cikti), `adnansahin ${parmakIzi(a.cikti)} · testfabrika ${parmakIzi(t.cikti)}`);
}
{
  const o = ortam();
  const r = otaCheckKanal(o, 'testfabrika', [`--api-url=${FABRIKA_ERP}`]);
  ol('4e fabrika adresi + --musteri=testfabrika → DUR (hazırlık tabletleri fabrikaya yazmaz)',
    r.kod !== 0 && /ERP ADRESİ "testfabrika" KANALININ DEĞİL/.test(r.cikti), r.cikti.slice(-400));
}
{
  const o = ortam();
  const r = otaCheckKanal(o, 'testfabrika');
  ol('4f adres verilmezse kanal kaydından çözülür (--api-url gerekmez)',
    r.kod === 0 && /kaynak {10}: kanal kaydı "testfabrika"/.test(r.cikti) && r.cikti.includes(TEST_ERP), r.cikti.slice(0, 800));
}
{
  const o = ortam();
  const r = otaCheckKanal(o, 'testfabrika', [], { ortamEk: { TEKSERP_KANAL: 'adnansahin' } });
  ol('4g ortamda başka kanal (TEKSERP_KANAL=adnansahin) + --musteri=testfabrika → DUR', r.kod !== 0 && /KANAL ÇELİŞKİSİ/.test(r.cikti), r.cikti.slice(-300));
}
{
  // Eski d5 reçetesi: app.json'u kanal için elle çevirmek → parmak izi girdisi değişir (sahte NATIVE DEĞİŞTİ).
  const o = ortam();
  const agac = mobilAgaci(o, (aj) => { aj.expo.android.package = 'com.teks.erp.mobil.testfabrika'; aj.expo.name = 'TeksERP Test'; });
  const r = otaCheckKanal(o, 'testfabrika', [], { cwd: path.join(agac, 'mobil') });
  ol('4h app.json kanal için yeniden yazılmış → DUR (parmak izi kimlikten bağımsız kalmalı)',
    r.kod !== 0 && /app\.json DİNLENME KİMLİĞİNİ \("adnansahin"\) TAŞIMIYOR/.test(r.cikti), r.cikti.slice(-500));
  const r2 = otaCheckKanal(o, 'testfabrika', [], { cwd: path.join(mobilAgaci(o), 'mobil') });
  ol('4h kontrol: aynı kopya ağaç app.json dokunulmadan → geçer (sonda kopyanın kendisini ölçmüyor)',
    r2.kod === 0 && /Kanal {13}: testfabrika/.test(r2.cikti), r2.cikti.slice(-500));
}
{
  const o = ortam();
  const tf = otaCheckKanal(o, 'testfabrika', ['--terfi-atla=fabrika çöktü, test turu beklemeden düzeltmeyi çıkar']);
  ol('4p testfabrika + --terfi-atla → DUR (terfi istemeyen kanalda kaçış anlamsız)', tf.kod !== 0 && /terfi istemiyor/.test(tf.cikti), tf.cikti.slice(-400));
  const tf2 = otaCheckKanal(o, 'testfabrika');
  ol('4q testfabrika (terfiKaynagi yok) terfi satırı BASMAZ — davranışı değişmedi', tf2.kod === 0 && !/terfi/i.test(tf2.cikti), tf2.cikti.slice(-400));
}

/* ------------------------------------------------------------------ *
 * §5 yüklemler
 * ------------------------------------------------------------------ */

console.log('\n§5 — ortak yüklemler');
{
  const d = dosyalariOku([...TABLET_SABIT_DOSYALAR, ...PANEL_SABIT_DOSYALAR]);
  ol('5a adnansahin: ağacın panel + tablet kimliği kayıtla birebir',
    panelSabitKimlikFarki(kanalCoz('adnansahin').kanal, d).length === 0 && tabletSabitKimlikFarki(kanalCoz('adnansahin').kanal, d).length === 0);
  const tf = tabletSabitKimlikFarki(kanalCoz('testfabrika').kanal, d);
  ol('5b testfabrika kimliği app.json\'da YOK — app.json dinlenme (varsayilan) kimliğidir, kanal derleme anında enjekte edilir',
    tf.some((x) => x.includes('android.package')) && tf.some((x) => x.includes('codeSigningCertificate')), tf.join('\n'));
  const o = ortam();
  const y = apk(o);
  ol('5c zip okuyucu: deflate + stored girdi, olmayan girdi hata döner',
    zipGirdisiOku(y, 'AndroidManifest.xml').veri?.toString('utf16le').includes('/adnansahin/mobil/') &&
      zipGirdisiOku(y, 'assets/index.android.bundle').veri?.toString('latin1').includes(FABRIKA_ERP) &&
      /bulunamadı/.test(zipGirdisiOku(y, 'yok.txt').hata ?? ''));
  const m = bundleAdresOlcumu(`x${FABRIKA_ERP}yy${FABRIKA_ERP}zz`, FABRIKA_ERP);
  const m2 = bundleAdresOlcumu(`x${FABRIKA_ERP}http://10.0.0.5:4000/api`, FABRIKA_ERP);
  ol('5d bundle ölçümü: sayar, uç uca dizede de bulur, yabancı sayısal IP\'yi ayırır',
    m.gecenSayi === 2 && m.yabanciIp.length === 0 && m2.yabanciIp.join() === 'http://10.0.0.5:4000/api');
  const pem = '-----BEGIN CERTIFICATE-----\r\nMIIB\r\n-----END CERTIFICATE-----\r\n';
  const k = apkKimligi(apk(o, { paket: 'com.teks.erp.mobil.testfabrika', feed: `${YAYIN_HOST}testfabrika/mobil/`, sertifikaPem: pem, appConfig: { name: 'TeksERP Test' } }));
  ol('5e ikili manifest okuyucu: paket adı öznitelikten, meta-data (adres + CRLF\'li sertifika) birebir, app.config okunur',
    k.paket === 'com.teks.erp.mobil.testfabrika' && k.guncellemeAdresi === `${YAYIN_HOST}testfabrika/mobil/ota/54.2/manifest` &&
      k.sertifikaPem === pem && k.guncellemeAcik === 'true' && k.appConfig?.name === 'TeksERP Test', JSON.stringify(k));
  let bozukHata = null;
  try { axmlOgeleri(Buffer.from('<manifest/>')); } catch (e) { bozukHata = e.message; }
  ol('5f ikili olmayan manifest → ÖLÇÜLEMEDİ (metin olarak "okunmuş" sayılmaz)', /AXML/.test(bozukHata ?? ''), String(bozukHata));
  const cift = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const [a, b] = [cift(), cift()];
  const pub = (k) => k.publicKey.export({ type: 'spki', format: 'pem' });
  const man = { id: 'x', runtimeVersion: '54.2', extra: {} };
  const govde = multipartKur({ manifest: man, imzaBasligiDegeri: imzaBasligi(JSON.stringify(man), a.privateKey.export({ type: 'pkcs8', format: 'pem' }), 'main') });
  const ayri = imzayiKabulEdenler(govde, { imzalayan: pub(a), baska: pub(b) });
  const paylasilan = imzayiKabulEdenler(govde, { imzalayan: pub(a), ayniAnahtar: pub(a) });
  ol('5g çapraz red yüklemi: ayrı anahtarlı kanal imzayı REDDEDER, aynı anahtarı paylaşan KABUL eder (yayinla-ota bu ikinciyi durdurur)',
    ayri.join() === 'imzalayan' && paylasilan.join() === 'imzalayan,ayniAnahtar', `ayri=${ayri} paylasilan=${paylasilan}`);
}

{
  const y = path.join(GECICI, 'deneme.asar');
  asarYaz(y, { 'package.json': '{"name":"x"}', 'out/main/main.js': 'const a = "b";' });
  const ic = asarOku(y, () => true);
  const bozuk = path.join(GECICI, 'bozuk.asar');
  fs.writeFileSync(bozuk, 'bozuk-arsiv');
  let olculemedi = false;
  try {
    asarOku(bozuk, () => true);
  } catch (e) {
    olculemedi = e?.constructor?.name === 'Olculemedi';
  }
  ol('5h asar okuyucu: yazılanı birebir okur, bozuk arşiv ÖLÇÜLEMEDİ (ihlal değil)',
    ic['package.json']?.toString() === '{"name":"x"}' && ic['out/main/main.js']?.toString() === 'const a = "b";' && olculemedi);
}
{
  // Commit kapısı tetiği bu bekçinin OKUDUĞU her dosyayı kapsamalı: koşturulan betikler + yerel
  // import kapanışları + kabuğun çağırdığı node betikleri + ağaç kopyası. Liste ölçülür, sayılmaz.
  // app.config.js yayinla-ota'nın dinamik require'ı + mobil ağaç kopyası (import deseninde görünmez).
  const kosulan = ['scripts/test_kanal_yayin_kapisi.mjs', 'deploy/mobil-yayinla.mjs', 'mobil/scripts/yayinla-ota.mjs',
    'mobil/scripts/build-apk.mjs', 'mobil/app.config.js',
    'deploy/electron-yayinla.sh', 'deploy/electron-paketle.sh', ...ORTAK_KAYNAK, ...TABLET_SABIT_DOSYALAR];
  const okunan = new Set();
  const gez = (rel) => {
    if (okunan.has(rel) || !fs.existsSync(path.join(KOK, rel))) return;
    okunan.add(rel);
    const m = fs.readFileSync(path.join(KOK, rel), 'utf8');
    const yerel = [...m.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)].map((x) => x[1]);
    const kabuk = [...m.matchAll(/\$kok\/(scripts\/[\w./-]+\.mjs)/g)].map((x) => x[1]);
    for (const y of yerel) gez(path.posix.normalize(path.posix.join(path.posix.dirname(rel), y)));
    for (const y of kabuk) gez(y);
  };
  for (const f of kosulan) gez(f);
  const disarida = [...okunan].filter((f) => !kanalBekcisiTetigi(f));
  ol(`5i commit kapısı tetiği bu bekçinin okuduğu ${okunan.size} dosyanın HEPSİNİ kapsıyor (import kapanışı ölçüldü)`,
    okunan.size > 15 && disarida.length === 0, disarida.join('\n'));
}

/* ------------------------------------------------------------------ *
 * §6 build-apk.mjs (--verify-only / --check, ağsız: --yoklama-yok)
 * ------------------------------------------------------------------ */

console.log('\n§6 — build-apk.mjs: kanal argümandan, APK\'nın kendi kimliği hedef kanalın mı');
const buildApk = (o, args, { ortamEk = {} } = {}) => kos(o, process.execPath, [path.join(KOK, 'mobil/scripts/build-apk.mjs'), '--yoklama-yok', ...args],
  { cwd: path.join(KOK, 'mobil'), ortamEk });
{
  const o = ortam();
  const r = buildApk(o, [`--verify-only=${apk(o)}`]);
  ol('6a --musteri yok → DUR (derleme niyetsiz koşmaz)', r.kod !== 0 && /HANGİ KANAL İÇİN DERLENİYOR/.test(r.cikti), r.cikti.slice(-300));
}
{
  const o = ortam();
  const r = buildApk(o, ['--musteri=testfabirka', `--verify-only=${apk(o)}`]);
  ol('6b bilinmeyen kanal → DUR', r.kod !== 0 && /BİLİNMEYEN KANAL/.test(r.cikti), r.cikti.slice(-300));
}
{
  const o = ortam();
  const r = buildApk(o, ['--musteri=adnansahin', `--api-url=${TEST_ERP}`, `--verify-only=${apk(o)}`]);
  ol('6c testfabrika adresi + --musteri=adnansahin → DUR (APK bu adresi gömemez)', r.kod !== 0 && /ERP ADRESİ "adnansahin" KANALININ DEĞİL/.test(r.cikti), r.cikti.slice(-300));
}
{
  const o = ortam();
  const r = buildApk(o, ['--musteri=testfabrika', `--verify-only=${apk(o)}`], { ortamEk: { TEKSERP_KANAL: 'adnansahin' } });
  ol('6d ortamda başka kanal → DUR (KANAL ÇELİŞKİSİ)', r.kod !== 0 && /KANAL ÇELİŞKİSİ/.test(r.cikti), r.cikti.slice(-300));
}
{
  const o = ortam();
  const y = apk(o, { paket: 'com.teks.erp.mobil.testfabrika', feed: `${YAYIN_HOST}testfabrika/mobil/` });
  const r = buildApk(o, ['--musteri=adnansahin', `--verify-only=${y}`]);
  ol('6e yanlış paket adlı APK (testfabrika) + --musteri=adnansahin → DUR, APK kanonik adından taşınır',
    r.kod !== 0 && /APK "adnansahin" KANALININ KİMLİĞİNİ TAŞIMIYOR/.test(r.cikti) &&
      /paket adı "com\.teks\.erp\.mobil\.testfabrika" ≠ "com\.teks\.erp\.mobil"/.test(r.cikti) &&
      !fs.existsSync(y) && fs.existsSync(y.replace(/\.apk$/, '.DOGRULANMADI.apk')), r.cikti.slice(-700));
}
{
  const o = ortam();
  const r = buildApk(o, ['--musteri=testfabrika', `--verify-only=${apk(o, { paket: 'com.teks.erp.mobil.testfabrika', feed: `${YAYIN_HOST}testfabrika/mobil/`, erp: TEST_ERP,
    appConfig: { name: 'TeksERP', android: { package: 'com.teks.erp.mobil.testfabrika' }, updates: { url: `${YAYIN_HOST}adnansahin/mobil/ota/54.2/manifest` } } })}`]);
  ol('6f paket adı doğru ama gömülü çalışma anı yapılandırması fabrikanın (künye fabrikadan okunurdu) → DUR',
    r.kod !== 0 && /assets\/app\.config updates\.url/.test(r.cikti) && /assets\/app\.config name/.test(r.cikti), r.cikti.slice(-700));
}
{
  const o = ortam();
  const r = buildApk(o, ['--musteri=adnansahin', `--verify-only=${apk(o, { manifestBozuk: true })}`]);
  ol('6g APK manifesti okunamıyor → ÖLÇÜLEMEDİ, DUR', r.kod !== 0 && /ÖLÇÜLEMEDİ — APK kimliği okunamadı/.test(r.cikti), r.cikti.slice(-300));
}
{
  // Pozitif (kapı aşırı sert değil): kimliği TAM doğru sahte APK kanal kapısından geçer. Sertifika kıyası
  // gerçek sertifika ister → yalnız keystore/ olan makinede (TEKSERP_STRICT=1'de zorunlu).
  const sertYol = path.join(KOK, 'mobil', kanalCoz('testfabrika').kanal.tablet.otaSertifika);
  if (fs.existsSync(sertYol) || process.env.TEKSERP_STRICT === '1') {
    const o = ortam();
    const tfCfg = { name: 'TeksERP Test', android: { package: 'com.teks.erp.mobil.testfabrika' },
      updates: { url: `${YAYIN_HOST}testfabrika/mobil/ota/54.2/manifest` }, extra: { gorunurEtiket: 'TEST FABRİKA' } };
    const tam = apk(o, { paket: 'com.teks.erp.mobil.testfabrika', feed: `${YAYIN_HOST}testfabrika/mobil/`, erp: TEST_ERP,
      sertifikaPem: fs.readFileSync(sertYol, 'utf8'), appConfig: tfCfg });
    const r = buildApk(o, ['--musteri=testfabrika', `--verify-only=${tam}`]);
    ol('6h pozitif: kimliği tam doğru testfabrika APK\'sı kanal kapısından GEÇER (sonraki mühür kapısı ayrı)',
      /✔ APK "testfabrika" kanalının kimliğini taşıyor/.test(r.cikti), r.cikti.slice(0, 900));
    const tamYanlisSert = apk(o, { paket: 'com.teks.erp.mobil.testfabrika', feed: `${YAYIN_HOST}testfabrika/mobil/`, erp: TEST_ERP,
      sertifikaPem: fs.readFileSync(path.join(KOK, 'mobil', kanalCoz('adnansahin').kanal.tablet.otaSertifika), 'utf8'), appConfig: tfCfg });
    const r2 = buildApk(o, ['--musteri=testfabrika', `--verify-only=${tamYanlisSert}`]);
    ol('6i her şey testfabrika ama gömülü OTA sertifikası fabrikanın → DUR (fabrika anahtarıyla imzalı paketi kabul ederdi)',
      r2.kod !== 0 && /gömülü OTA sertifikası "testfabrika" kanalınınki değil/.test(r2.cikti), r2.cikti.slice(-500));
  } else {
    console.log('ℹ️  6h/6i atlandı — keystore/ yok (sertifika kıyası ölçülemez; TEKSERP_STRICT=1 ile zorunlu)');
  }
}

{
  // Terfi (K5) APK derleyicisi: --check yolunda ölçülür (derleme yok); --verify-only derleme/yayın değildir, ölçmez.
  const o = ortam();
  const kosApk = (agac, ek = []) => kos(o, process.execPath, [path.join(agac, 'mobil/scripts/build-apk.mjs'), '--yoklama-yok', '--check', '--musteri=adnansahin', ...ek],
    { cwd: path.join(agac, 'mobil') });
  const etiketsiz = kosApk(tabletTerfiAgaci(o, { terfiEtiketi: null, surumEtiketi: null }));
  ol('6j build-apk --check adnansahin, etiketsiz ağaç → TERFİ KAPISI DUR (derleme ortamına gelmeden)',
    etiketsiz.kod !== 0 && /TERFİ KAPISI/.test(etiketsiz.cikti) && /onay etiketi YOK/.test(etiketsiz.cikti) && !/DERLEME ORTAMI/.test(etiketsiz.cikti), etiketsiz.cikti.slice(-600));
  const tam = kosApk(tabletTerfiAgaci(o));
  ol('6k build-apk --check adnansahin, terfi etiketli ağaç + testfabrika künyesi ≥ X → terfi kapısı GEÇER',
    /✓ terfi kapısı: tablet/.test(tam.cikti) && !/TERFİ KAPISI —|TERFİ KAPISI ÖLÇÜLEMEDİ/.test(tam.cikti), tam.cikti.slice(-900));
}

/* ------------------------------------------------------------------ *
 * §7 electron-* terfi kapısı (K5) — adnansahin yalnız terfi etiketli commit'ten, testfabrika'da yayınlanmış sürümle
 * ------------------------------------------------------------------ */

console.log('\n§7 — panel terfi kapısı: ssh\'tan ÖNCE, paketlemede derlemeden ÖNCE; kaçış yalnız kullanıcının cümlesiyle');
{
  const durDurum = (ad, sen, desen) => {
    const { o, r } = yayinSenaryosu(sen);
    ol(ad, r.kod !== 0 && yazanAg(o).length === 0 && engellenen(o).length === 0 && desen.test(r.cikti), r.cikti.slice(-700));
    return { o, r };
  };
  durDurum('7a HEAD ≠ panel-v9.9.9 (etiket bir önceki commit\'te) → DUR, ssh/scp SIFIR', { terfi: { surumEtiketi: 'onceki' } }, /HEAD \([0-9a-f]+\) ≠ panel-v9\.9\.9/);
  durDurum('7b terfi/adnansahin/panel-v9.9.9 YOK → DUR, ssh/scp SIFIR', { terfi: { terfiEtiketi: null } }, /onay etiketi YOK/);
  durDurum('7c terfi etiketi HAFİF (mesajsız) → DUR', { terfi: { terfiEtiketi: 'hafif' } }, /AÇIKLAMALI değil/);
  durDurum('7d testfabrika'+"'"+'da yayındaki 9.9.8 < 9.9.9 (kaynak GERİDE) → DUR', { terfi: { kaynakSurum: '9.9.8' } }, /testfabrika kanalı GERİDE — panel latest\.yml: 9\.9\.8/);
  durDurum('7e testfabrika'+"'"+'da hiç panel yayını yok → DUR', { terfi: { kaynakSurum: null } }, /GERİDE — panel latest\.yml: yayın yok/);
  {
    const o = ortam();
    const agac = agacKur(o);
    terfiHazirla(o, agac, {});
    panelArtefakti(path.join(agac, 'Electron/release/adnansahin/9.9.9'), { ...ADNANSAHIN_PANEL, surum: '9.9.9' });
    const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '9.9.9'], { cwd: agac, ortamEk: { SAHTE_SSH_KOPUK: '/testfabrika/' } });
    ol('7f testfabrika okunamıyor (ssh bağlantı reddi) → ÖLÇÜLEMEDİ, DUR, scp SIFIR, ssh yalnız o okuma girişimi',
      r.kod !== 0 && iz(o).filter((x) => x.startsWith('ssh') || x.startsWith('scp')).join('|') === KAYNAK_OKU && /TERFİ KAPISI ÖLÇÜLEMEDİ/.test(r.cikti) && /OKUNAMADI/.test(r.cikti), r.cikti.slice(-700));
  }
  durDurum('7g --terfi-atla= (boş cümle) → DUR', { terfi: { terfiEtiketi: null }, ekArg: ['--terfi-atla='] }, /REDDEDİLDİ: cümle BOŞ/);
  durDurum('7h --terfi-atla (cümlesiz bayrak) → DUR', { terfi: { terfiEtiketi: null }, ekArg: ['--terfi-atla'] }, /REDDEDİLDİ: cümle BOŞ/);
  durDurum('7i --terfi-atla="acil yayınla" (kısa: 2 kelime) → DUR', { terfi: { terfiEtiketi: null }, ekArg: ['--terfi-atla=acil yayınla'] }, /REDDEDİLDİ: cümle KISA/);
  durDurum('7j testfabrika + --terfi-atla="<cümle>" → DUR (terfi istemeyen kanalda kaçış yok)',
    { musteriArg: '--musteri=testfabrika', artefakt: TESTFABRIKA_PANEL, dizin: 'testfabrika', ekArg: ["--terfi-atla=fabrika çöktü, test'siz çıkıyoruz, sorumluluk bende"] }, /terfi istemiyor/);
  {
    // Kaçış: etiketsiz ağaç, kaynak yok — geçer; cümle defter satırına ve İKİ etiket mesajına (engellenen git çağrıları) yazılır.
    const cumle = "fabrika paneli açılmıyor, test'siz acil düzeltme — kullanıcı onayı";
    const { o, r } = yayinSenaryosu({ terfi: { terfiEtiketi: null, surumEtiketi: null, kaynakSurum: null }, ekArg: [`--terfi-atla=${cumle}`] });
    const defter = path.join(o.uzak, VDS, 'defter/adnansahin-YAYIN-DEFTERI.tsv');
    const satir = fs.existsSync(defter) ? fs.readFileSync(defter, 'utf8').trim().split('\n').pop() : '';
    const etiketler = engellenen(o);
    ol('7k --terfi-atla="<kullanıcının cümlesi>" → yayın yapılır (çıkış 0), kaynak kanal OKUNMAZ',
      r.kod === 0 && /TERFİ KAPISI ATLANDI/.test(r.cikti) && agText(o).some((c) => c.arac === 'scp') &&
        !o.cagrilar().some((c) => (c.arac === 'curl' && c.url.includes('/testfabrika/')) || (c.arac === 'ssh' && String(c.komut).includes('/testfabrika/'))), r.cikti.slice(-800));
    ol('7k yayın defteri satırı 6 kolon, 6. kolon "terfi-atlandi: <cümle>" (tek tırnaklı cümle bozulmadan)',
      satir.split('\t').length === 6 && satir.split('\t')[5] === `terfi-atlandi: ${cumle}`, JSON.stringify(satir));
    ol('7k etiket MESAJLARI cümleyi taşır: panel-v9.9.9 + terfi/adnansahin/panel-v9.9.9 (git tag -a girişimleri)',
      etiketler.some((e) => e.startsWith('tag -a panel-v9.9.9 -m TERFİ ATLANDI') && e.includes(cumle)) &&
        etiketler.some((e) => e.startsWith('tag -a terfi/adnansahin/panel-v9.9.9 -m TERFİ ATLANDI') && e.includes(cumle) && /saat: \d{4}-\d\d-\d\dT/.test(e)),
      etiketler.join('\n---\n'));
    const { o: o2 } = yayinSenaryosu();
    const satir2 = fs.readFileSync(path.join(o2.uzak, VDS, 'defter/adnansahin-YAYIN-DEFTERI.tsv'), 'utf8').trim();
    ol('7k kontrol: kaçışsız yayında defter satırı bugünkü gibi 5 kolon', satir2.split('\t').length === 5, satir2);
  }
  {
    const { o, r } = yayinSenaryosu({ ekArg: ['--kuru'], terfi: { kaynakSurum: null } });
    ol('7l --kuru (terfi etiketli ağaç): git şartları ölçülür, kaynak kanal ÖLÇÜLMEZ (ağ yok) → çıkış 0',
      r.kod === 0 && agSifir(o) && /ÖLÇÜLMEDİ \(kuru kip/.test(r.cikti), r.cikti.slice(-600));
    const { o: o2, r: r2 } = yayinSenaryosu({ ekArg: ['--kuru'], terfi: { terfiEtiketi: null } });
    ol('7l --kuru etiketsiz → DUR (git şartları kuru kipte de ölçülür)', r2.kod !== 0 && agSifir(o2) && /onay etiketi YOK/.test(r2.cikti), r2.cikti.slice(-500));
  }
  {
    // ⭐ SONDA: terfi çağrısı sökülürse etiketsiz commit fabrikaya YÜKLENİR — 7b'nin kapıyı ölçtüğünün kanıtı.
    const { o } = yayinSenaryosu({ terfi: { terfiEtiketi: null },
      mutasyon: (m) => m.replaceAll('kanal-kapisi.mjs" terfi "$musteri"', 'kanal-kapisi.mjs" kanal "$musteri"') });
    ol('7m ⭐ SONDA: yayıncıdan terfi kapısı sökülünce etiketsiz commit adnansahin\'e yüklenir (kapı yük taşıyor)',
      agText(o).some((c) => c.arac === 'scp'), iz(o).join('\n'));
  }
  {
    const s = paketleSenaryosu(['adnansahin', SURUM], { terfi: { terfiEtiketi: null } });
    ol('7n paketle adnansahin, onay etiketi yok → DUR: derleme YOK, dinlenme dosyaları DEĞİŞMEDİ',
      s.r.kod !== 0 && !s.o.cagrilar().some((c) => c.arac === 'npm') && s.once === s.sonra && /onay etiketi YOK/.test(s.r.cikti), s.r.cikti.slice(-600));
    const k = paketleSenaryosu(['adnansahin', SURUM], { terfi: { kaynakSurum: '0.0.1' } });
    ol('7o paketle adnansahin, testfabrika geride → DUR, derleme YOK', k.r.kod !== 0 && !k.o.cagrilar().some((c) => c.arac === 'npm') && /GERİDE/.test(k.r.cikti), k.r.cikti.slice(-500));
    const a = paketleSenaryosu(['adnansahin', SURUM, '--terfi-atla=fabrika paneli çöktü, testsiz acil derleme gerekiyor'], { terfi: { terfiEtiketi: null, surumEtiketi: null, kaynakSurum: null } });
    ol('7p paketle adnansahin --terfi-atla="<cümle>" → derler (çıkış 0), yayın ipucu cümleyi de ister',
      a.r.kod === 0 && Boolean(npmCagrisi(a.o)) && /TERFİ KAPISI ATLANDI/.test(a.r.cikti) && /--terfi-atla=/.test(a.r.cikti), a.r.cikti.slice(-600));
    const b = paketleSenaryosu(['adnansahin', SURUM, '--terfi-atla='], { terfi: { terfiEtiketi: null } });
    ol('7q paketle --terfi-atla= (boş) → DUR, derleme YOK', b.r.kod !== 0 && !b.o.cagrilar().some((c) => c.arac === 'npm') && /cümle BOŞ/.test(b.r.cikti), b.r.cikti.slice(-400));
    const m = paketleSenaryosu(['adnansahin', SURUM], { terfi: { terfiEtiketi: null },
      mutasyon: (x) => x.replaceAll('kanal-kapisi.mjs" terfi "$musteri"', 'kanal-kapisi.mjs" kanal "$musteri"') });
    ol('7r ⭐ SONDA: paketleyiciden terfi kapısı sökülünce etiketsiz commit derlenir (7n kapıyı ölçüyor)', Boolean(npmCagrisi(m.o)), m.r.cikti.slice(-400));
  }
}

/* ------------------------------------------------------------------ *
 * §8 panel İMZALI KÜNYE (G5)
 * ------------------------------------------------------------------ */

console.log('\n§8 — panel imzalı künye: imzasız/geçersiz künyeli latest.yml YÜKLENMEZ, boş çapalı panel paketlenmez');
{
  const scpYok = (o) => !o.cagrilar().some((c) => c.arac === 'scp');
  /** Kapı yüklemeden ÖNCE durdu: ssh/scp'nin tek izi terfi kapısının kaynak kanal OKUMASI (bkz. 1a). */
  const yalnizTerfiOkumasi = (o) => iz(o).filter((x) => x.startsWith('ssh') || x.startsWith('scp')).every((x) => x === KAYNAK_OKU);
  {
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: null } });
    ol('8a imzasız latest.yml + imza anahtarı YOK → DUR, yükleme/ssh yazımı SIFIR, TR hata', r.kod !== 0 && yalnizTerfiOkumasi(o) &&
      /İMZASIZ ve imza anahtarı verilmedi/.test(r.cikti), r.cikti.slice(-500));
  }
  {
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: null }, ekArg: ['--anahtar=/yok/panel-2099.panel.json'] });
    const npx = o.cagrilar().find((c) => c.arac === 'npx' && /tsx scripts\/panel-imza\.ts imzala --musteri=adnansahin --dizin-paket=\S+ --anahtar=\/yok\/panel-2099\.panel\.json/.test(c.args));
    ol('8b imzasız + --anahtar → imza aracı ÇAĞRILIR; imzalamadıysa (künye hâlâ yok) DUR, yükleme SIFIR',
      r.kod !== 0 && Boolean(npx) && yalnizTerfiOkumasi(o) && /İmzalanan künye kapıdan geçmedi/.test(r.cikti), `${JSON.stringify(npx)}\n${r.cikti.slice(-500)}`);
  }
  for (const [ad, kunye, desen] of [
    ['8c çapada olmayan anahtarla imzalı (JWS_KID)', { anahtar: IMZA_YABANCI }, /JWS_KID/],
    ['8d başka kanalın künyesi (KUNYE_KANAL)', { kanal: 'testfabrika' }, /KUNYE_KANAL/],
    ['8e künyenin capa listesi pakete gömülü çapa değil', { capa: ['panel-2098'] }, /çapa listesi/],
  ]) {
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye } });
    ol(`${ad} → DUR, yükleme SIFIR`, r.kod !== 0 && yalnizTerfiOkumasi(o) && /GEÇERSİZ/.test(r.cikti) && desen.test(r.cikti), r.cikti.slice(-500));
  }
  {
    const o = ortam();
    const agac = agacKur(o);
    terfiHazirla(o, agac, { surum: '9.9.9' });
    const rel = path.join(agac, 'Electron/release/adnansahin/9.9.9');
    panelArtefakti(rel, { ...ADNANSAHIN_PANEL, surum: '9.9.9' });
    fs.appendFileSync(path.join(rel, 'TeksERP-9.9.9-Setup.exe'), 'kurcalandı');
    const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '9.9.9'], { cwd: agac });
    ol('8f künyeden SONRA değişmiş kurulum dosyası (DOSYA_OZETI) → DUR, yükleme SIFIR', r.kod !== 0 && yalnizTerfiOkumasi(o) && /DOSYA_OZETI/.test(r.cikti), r.cikti.slice(-400));
  }
  {
    const o = ortam();
    const agac = agacKur(o, { capa: [] });
    terfiHazirla(o, agac, { surum: '9.9.9' });
    panelArtefakti(path.join(agac, 'Electron/release/adnansahin/9.9.9'), { ...ADNANSAHIN_PANEL, surum: '9.9.9' });
    const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '9.9.9'], { cwd: agac });
    ol('8g ağacın çapası BOŞ → DUR (CAPA_BOS), yükleme SIFIR', r.kod !== 0 && yalnizTerfiOkumasi(o) && /CAPA_BOS/.test(r.cikti), r.cikti.slice(-400));
  }
  {
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, capaGomulu: [] } });
    ol('8h paket çapayı/doğrulayıcıyı GÖMMEMİŞ (eski derleme) → DUR, yükleme SIFIR', r.kod !== 0 && yalnizTerfiOkumasi(o) && /çapa anahtarı panel-2099 yok/.test(r.cikti), r.cikti.slice(-400));
  }
  /** Kanalda yayındaki (9.9.8) künyeli latest.yml: `capa` = o sürümün panellerinin tanıdığı anahtarlar. */
  const yayindaki = (o, capa) => panelArtefakti(path.join(o.uzak, VDS, 'html/adnansahin/electron'),
    { ...ADNANSAHIN_PANEL, surum: '9.9.8', kunye: { anahtar: IMZA_ONCEKI, capa } });
  const rotasyonSenaryosu = (capa, ek = {}) => {
    const o = ortam();
    const agac = agacKur(o);
    terfiHazirla(o, agac, { surum: '9.9.9' });
    yayindaki(o, capa);
    panelArtefakti(path.join(agac, 'Electron/release/adnansahin/9.9.9'), { ...ADNANSAHIN_PANEL, surum: '9.9.9' });
    if (ek.mutasyon) {
      const y = path.join(agac, 'deploy/electron-yayinla.sh');
      const once = fs.readFileSync(y, 'utf8');
      const sonra = ek.mutasyon(once);
      if (sonra === once) throw new Error('rotasyon mutasyonu UYGULANMADI — sonda geçersiz');
      fs.writeFileSync(y, sonra);
    }
    return { o, r: kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '9.9.9'], { cwd: agac, ortamEk: ek.ortamEk }) };
  };
  {
    const { o, r } = rotasyonSenaryosu(['panel-2098']);
    ol('8i ⭐ ROTASYON KİLİDİ: yayındaki 9.9.8 yalnız panel-2098 tanır, 9.9.9 panel-2099 ile imzalı → DUR, scp SIFIR',
      r.kod !== 0 && scpYok(o) && /ROTASYON KİLİDİ/.test(r.cikti) && /KURMAZLAR/.test(r.cikti), r.cikti.slice(-500));
  }
  {
    const { o, r } = rotasyonSenaryosu(['panel-2098', 'panel-2099']);
    const sirali = iz(o);
    ol('8j rotasyon geçer (yayındaki çapa yeni imzalayanı tanıyor) → yükler; yayındaki latest.yml ssh ile OKUNDU, yüklemeden ÖNCE',
      r.kod === 0 && sirali.indexOf(`ssh oku ${VDS}/html/adnansahin/electron/latest.yml`) >= 0 &&
        sirali.indexOf(`ssh oku ${VDS}/html/adnansahin/electron/latest.yml`) < sirali.findIndex((x) => x.startsWith('scp')) &&
        /✓ kenardaki latest\.yml = imzalı künyeli yerel dosya/.test(r.cikti), `${r.cikti.slice(-500)}\n${sirali.join('\n')}`);
  }
  {
    const { o, r } = rotasyonSenaryosu(['panel-2098', 'panel-2099'], { ortamEk: { SAHTE_SSH_KOPUK: 'adnansahin/electron/latest.yml' } });
    ol('8k yayındaki latest.yml okunamıyor (kopuk ssh) → ÖLÇÜLEMEDİ = DUR, scp SIFIR', r.kod !== 0 && scpYok(o) && /ÖLÇÜLEMEDİ/.test(r.cikti), r.cikti.slice(-400));
  }
  {
    const { o, r } = rotasyonSenaryosu(['panel-2098'], {
      mutasyon: (m) => m.replace('node "$kok/scripts/kanal-kapisi.mjs" panel-rotasyon "$musteri" "$rel" "$yayindaki_yml" \\\n    ||', 'true \\\n    ||'),
    });
    ol('8l ⭐ SONDA: rotasyon çağrısı sökülünce 8i\'nin sürümü YÜKLENİR (kilit yük taşıyor)', r.kod === 0 && !scpYok(o), r.cikti.slice(-300));
  }
  const kunyeKapisiSokuk = (m) => m.replace('node "$kok/scripts/kanal-kapisi.mjs" panel-imza "$musteri" "$rel" || imza_durum=$?', 'imza_durum=0');
  const rotasyonSokuk = (m) => m.replace('node "$kok/scripts/kanal-kapisi.mjs" panel-rotasyon "$musteri" "$rel" "$yayindaki_yml" \\\n    ||', 'true \\\n    ||');
  {
    // İki kat: künye kapısı sökülse de rotasyon adımı yerel künyeyi yeniden ölçer (savunma derinliği).
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: null }, mutasyon: kunyeKapisiSokuk });
    ol('8m künye kapısı sökülse de rotasyon adımı imzasız künyeyi DURDURUR (ikinci kat), scp SIFIR',
      r.kod !== 0 && scpYok(o) && /paketin künyesi geçerli değil/.test(r.cikti), r.cikti.slice(-300));
    const { o: o2 } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: null }, mutasyon: (m) => rotasyonSokuk(kunyeKapisiSokuk(m)) });
    ol('8m ⭐ SONDA: iki kat da sökülünce İMZASIZ latest.yml YÜKLENİR (8a/8m kapıyı ölçüyor)', !scpYok(o2), iz(o2).join('\n'));
  }
  {
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: { anahtar: IMZA_YABANCI } }, ekArg: ['--kuru'] });
    ol('8n1 --kuru geçersiz künye (çapada olmayan anahtar) → DUR, ağ SIFIR (kuru da künyeyi ölçer)', r.kod !== 0 && agSifir(o) && /JWS_KID/.test(r.cikti), r.cikti.slice(-300));
    const { o: o2, r: r2 } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: { anahtar: IMZA_YABANCI } }, ekArg: ['--kuru'], mutasyon: kunyeKapisiSokuk });
    ol('8n2 ⭐ SONDA: künye kapısı sökülünce --kuru geçersiz künyeyi KABUL eder (8n1 kapıyı ölçüyor)', r2.kod === 0 && agSifir(o2), r2.cikti.slice(-300));
  }
  {
    const { o, r } = yayinSenaryosu({ artefakt: { ...ADNANSAHIN_PANEL, kunye: null }, ekArg: ['--kuru'] });
    ol('8n --kuru imzasız paket → KABUL (imzalamaz, anahtar istemez), ağ SIFIR, "İMZASIZ" notu',
      r.kod === 0 && agSifir(o) && /\[kuru\] künye\s+: İMZASIZ/.test(r.cikti) && !o.cagrilar().some((c) => c.arac === 'npx'), r.cikti.slice(-500));
  }
  {
    const o = ortam();
    const agac = agacKur(o);
    panelArtefakti(path.join(o.uzak, VDS, 'html/adnansahin/electron'), { ...ADNANSAHIN_PANEL, surum: '9.9.8', kunye: null });
    const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '--dogrula'], { cwd: agac });
    ol('8o --dogrula künyesiz yayın → çıkış 0 + UYARI (imza öncesi sürüm geçişte meşru)', r.kod === 0 && /KÜNYESİZ/.test(r.cikti), r.cikti.slice(-400));
    const o2 = ortam();
    const agac2 = agacKur(o2);
    panelArtefakti(path.join(o2.uzak, VDS, 'html/adnansahin/electron'), { ...ADNANSAHIN_PANEL, surum: '9.9.8', kunye: { anahtar: IMZA_YABANCI } });
    const r2 = kos(o2, path.join(agac2, 'deploy/electron-yayinla.sh'), ['--musteri=adnansahin', '--dogrula'], { cwd: agac2 });
    ol('8p --dogrula geçersiz künyeli yayın (çapada olmayan anahtar) → DUR', r2.kod !== 0 && /JWS_KID/.test(r2.cikti), r2.cikti.slice(-400));
  }
  {
    const s = paketleSenaryosu(['testfabrika', SURUM], { agacMutasyon: (agac) => kopyala(agac, PANEL_CAPA_REL, capaMetni([])) });
    ol('8q paketleme: çapa BOŞ → derleme YOK (çıkışsız kapı paketlenmez), dinlenme dosyaları aynı',
      s.r.kod !== 0 && !npmCagrisi(s.o) && /CAPA_BOS/.test(s.r.cikti) && s.once === s.sonra, s.r.cikti.slice(-400));
    const t = paketleSenaryosu(['testfabrika', SURUM]);
    const d = derlenen(t.agac, 'testfabrika');
    ol('8r paketleme: çapa derlenen ana sürece GÖMÜLÜ (kapı çıktıyı okur) + yayın komutu --anahtar ister',
      t.r.kod === 0 && d !== null && d.main.includes(`"${IMZA.x}"`) && /pakete gömülü/.test(t.r.cikti) && /--anahtar=/.test(t.r.cikti), t.r.cikti.slice(-400));
  }
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
if (kaldi.length) for (const a of kaldi) console.log(`   · ${a}`);
process.exit(kaldi.length ? 1 : 0);
