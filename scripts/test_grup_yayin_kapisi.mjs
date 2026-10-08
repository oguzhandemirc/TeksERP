#!/usr/bin/env node
// =============================================================================
// GRUP YAYIN KAPISI BEKÇİSİ (O10a) — `deploy/electron-grup-yayinla.sh` + `scripts/lib/grup-yayin.mjs`
// =============================================================================
// Yayın betiğinin KENDİSİ gerçek betik olarak koşar; ağ yok: PATH'e sahte ssh/scp/curl/npx konur (çağrı günlüğü),
// uzak dünya geçici dizindir. Hiçbir senaryo gerçek VDS'e, Cloudflare'e ya da anahtara dokunmaz.
//   §1 hüküm (saf): özet eşitliği · K-6 ikinci onay · kaçış · ölçülemedi
//   §2 hedef/grup: eski kanal kodu RED · bilinmeyen grup RED · hedef kayıttan türer · ezme ortamı RED
//   §3 test grubu: terfi etiketi İSTEMEZ; gerçek yayın (sahte uzak): paket ÖNCE latest.yml EN SON, künye kanalı = GRUP
//   §4 oncu/genel: etiketsiz RED · kaynak gruptan farklı özet RED · profil matrisi kapısı yoksa RED · K-6
//   §5 terfi: paket baytı bayt-eşit (ortak paket DEĞİŞMEZ), künye hedef grupla yeniden imzalı
//   §6 betik kaynağı: kapı çağrıları ve sırası (negatif sondalı)
//   §7 kök çapası + rotasyon kilidi (KÖK düzeyi): fikstür kökü RED · yayındaki v:1 / çapasında olmayan kök RED
//   §8 yıllık tören (I7): gerçek `yeniden-imzala` çıktısı panelden ve rotasyon kilidinden geçer · ⭐ 30 gün kapısı GERÇEK
//      imza aracıyla yayın betiğinin yolunda (29 gün → imza yok, yükleme yok; 90 günde kapı iletisi yok — kör değil)
// ÇIKIŞ: 0 yeşil · 1 KIRMIZI.   node scripts/test_grup_yayin_kapisi.mjs
// =============================================================================
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { KOK } from './lib/dagitim.mjs';
import { grupTerfiHukmu } from './lib/grup-yayin.mjs';
import { derlemeKunyesiYaz, PANEL_KUNYE_ADI } from './lib/derleme-bagi.mjs';
import { buildReleaseDoc, signReleaseDoc, verifyReleaseBlock } from '../Electron/electron/guncelleme/panel-kunye.mjs';
import { parseLatestYml, withReleaseBlock } from '../Electron/electron/guncelleme/latest-yml.mjs';
import { panelRotasyonDenetimi } from './lib/panel-imza-kapisi.mjs';
// Bekçi/koşucu gerçek Anahtar Zinciri'ne GİTMEZ: parola okuyan araçlar kasa yerine stdin/dosya kullanır (scripts/lib/parola-kasasi.mjs).
process.env.TEKSERP_PAROLA_KASASI = 'kapali';

let gecti = 0;
const kaldi = [];
function ol(ad, kosul, detay) {
  if (kosul) {
    gecti += 1;
    console.log(`✅ ${ad}`);
  } else {
    kaldi.push(ad);
    console.log(`❌ ${ad}${detay ? `\n   ${String(detay).split('\n').slice(0, 14).join('\n   ')}` : ''}`);
  }
}

const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-grup-'));
process.on('exit', () => fs.rmSync(GECICI, { recursive: true, force: true }));
const GERCEK_GIT = execFileSync('/usr/bin/env', ['sh', '-c', 'command -v git'], { encoding: 'utf8' }).trim();
// GIT_* SÖKÜLÜR: bekçi commit kapısından koşarsa hook ortamı geçici ağaçtaki git'i GERÇEK depoya yönlendirirdi.
const TEMIZ_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
for (const ad of ['SSH_HEDEF', 'UZAK_DIZIN', 'YAYIN_KOK', 'YAYIN_URL', 'BASE_URL', 'TEKSERP_PANEL_IMZA_ANAHTARI']) delete TEMIZ_ENV[ad];

const SURUM = '9.9.9';
const HOST = 'https://indir.etkiliyazilim.com/';
const UZAK_KOK = '/opt/stack/apps/tekserp-indir';
const ONAY_ONCU = 'Kullanıcı panel sürümünü öncü grup için onayladı 2026-10-06 10:00';
const ONAY_GENEL = 'Kullanıcı aynı sürümü herkese açmak için ikinci kez onayladı 2026-10-06 12:00';
const KACIS = 'Kullanıcı bugün acil yayın istedi';

/* ------------------------------------------------------------------ *
 * Test anahtarı + sahte araçlar
 * ------------------------------------------------------------------ */
// Zincir: kök (üretim biçimi `kok-<yıl>-<n>`; çapa kapısı fikstür kökünü reddeder) → ISTEMCI sertifikası → `ist-*`.
const SINIFLAR = ['URETIM', 'TEST', 'DR', 'DEMO', 'BAYI', 'BARINDIRILAN'];
const GUN_MS = 24 * 60 * 60 * 1000;
const b64u = (s) => Buffer.from(s).toString('base64url');
function anahtar(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { kid, privateKey, x: publicKey.export({ format: 'jwk' }).x };
}
/** Ham compact JWS (`node:crypto`): doğrulayıcının kendi imzalayıcısı sertifika üretmez, fikstür onu körleştirmesin. */
function hamJws(typ, imzalayan, yuk) {
  const girdi = `${b64u(JSON.stringify({ alg: 'EdDSA', typ, kid: imzalayan.kid }))}.${b64u(JSON.stringify(yuk))}`;
  return `${girdi}.${b64u(crypto.sign(null, Buffer.from(girdi, 'ascii'), imzalayan.privateKey))}`;
}
const istemciSertifikasi = (kok, ist) => hamJws('tekserp-sertifika', kok, {
  v: 1, sertifikaId: crypto.randomUUID(), kullanim: 'ISTEMCI', kid: ist.kid, x: ist.x, siniflar: ['URETIM'],
  baslangic: new Date(Date.now() - 30 * GUN_MS).toISOString(), bitis: new Date(Date.now() + 365 * GUN_MS).toISOString(), bayi: null,
});
const KOK_A = anahtar('kok-2099-1');
const IST = anahtar('ist-2099-1');
const SERTIFIKA = istemciSertifikasi(KOK_A, IST);
const IST_PEM = IST.privateKey.export({ type: 'pkcs8', format: 'pem' });
const TEST_CAPA = [{ kid: KOK_A.kid, x: KOK_A.x, classes: SINIFLAR }];

const SAHTE = path.join(GECICI, 'sahte-arac.mjs');
fs.writeFileSync(SAHTE, String.raw`
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [arac, ...a] = process.argv.slice(2);
const UZAK = process.env.SAHTE_UZAK;
const HOST = 'https://indir.etkiliyazilim.com/';
const yaz = (o) => fs.appendFileSync(process.env.CAGRI_LOG, JSON.stringify({ arac, ...o }) + '\n');
const uzakYol = (p) => path.join(UZAK, p);
const stdinOku = () => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } };
if (arac === 'ssh') {
  const k = [...a];
  while (k.length && k[0].startsWith('-')) { const o = k.shift(); if (o === '-p' || o === '-o') k.shift(); }
  const host = k.shift();
  const komut = k.join(' ');
  if (/^bash -s\b/.test(komut)) {
    const betik = stdinOku();
    const i = k.indexOf('--');
    const argv = i >= 0 ? k.slice(i + 1) : [];
    if (/ls -1t TeksERP-/.test(betik)) { yaz({ host, komut, tur: 'budama' }); process.exit(0); }
    yaz({ host, komut, betik, argv });
    const r = spawnSync('bash', ['-s', '--', ...argv.map((x) => x.replaceAll('/opt/stack', UZAK + '/opt/stack'))], { input: betik });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status ?? 1);
  }
  yaz({ host, komut });
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
  const hi = a.indexOf('-H');
  let belirtec = false;
  if (hi >= 0 && String(a[hi + 1]).startsWith('@')) {
    try { belirtec = /^X-TKL-Indirme: \S+$/m.test(fs.readFileSync(a[hi + 1].slice(1), 'utf8')); } catch { belirtec = false; }
  }
  yaz({ url: tem, bas, belirtec });
  if (!tem.startsWith(HOST)) { yaz({ YABANCI_AG: tem }); process.exit(6); }
  const dosya = uzakYol('/opt/stack/apps/tekserp-indir/html/' + tem.slice(HOST.length));
  const var_ = fs.existsSync(dosya) && fs.statSync(dosya).isFile();
  if (bicim) {
    if (var_ && !bas && !a.includes('/dev/null')) process.stdout.write(fs.readFileSync(dosya));
    process.stdout.write(bicim.replace('%{http_code}', var_ ? '200' : '404').replace('%{size_download}', var_ && !bas ? String(fs.statSync(dosya).size) : '0'));
    process.exit(0);
  }
  if (!var_) process.exit(f ? 22 : 0);
  if (!a.includes('/dev/null')) process.stdout.write(fs.readFileSync(dosya));
  process.exit(0);
}
if (arac === 'npx' && process.env.GERCEK_PANEL_IMZA) {
  // §8: GERÇEK imza aracı (parola dosyasından) — yayın yolundaki kapılar (30 gün) taklitle körleşmesin.
  yaz({ args: a.join(' '), gercek: true });
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(process.env.GERCEK_PANEL_IMZA, a[1]), ...a.slice(2), '--parola-dosyasi=' + process.env.GERCEK_PAROLA_DOSYASI], { cwd: process.env.GERCEK_PANEL_IMZA, stdio: ['ignore', 'inherit', 'inherit'] });
  process.exit(r.status ?? 1);
}
if (arac === 'npx') {
  // panel-imza.ts imzala taklidi: hedef GRUBUN adıyla v:2 künye (gerçek araç parola ister; burada bekçinin ist-* anahtarı + sertifikası).
  const bayrak = (ad) => (a.find((x) => x.startsWith('--' + ad + '=')) ?? '').slice(ad.length + 3);
  yaz({ args: a.join(' ') });
  if (a[1] !== 'scripts/panel-imza.ts' || a[2] !== 'imzala') process.exit(97);
  const { buildReleaseDoc, signReleaseDoc } = await import(process.env.KUNYE_LIB);
  const { withReleaseBlock } = await import(process.env.YML_LIB);
  const dizin = bayrak('dizin-paket');
  const yml = path.join(dizin, 'latest.yml');
  const sf = fs.readdirSync(dizin).find((x) => x.endsWith('-Setup.exe'));
  const govde = fs.readFileSync(path.join(dizin, sf));
  const doc = buildReleaseDoc({
    kanal: bayrak('musteri'), surum: sf.split('-')[1], commit: 'abcdef0', yayinZamani: '2026-10-06T07:00:00.000Z',
    paket: { ad: sf, boyut: govde.length, sha512: crypto.createHash('sha512').update(govde).digest('hex') }, capa: [process.env.KOK_KID],
  });
  const privateKey = crypto.createPrivateKey(process.env.IST_PEM);
  const token = signReleaseDoc({ doc, kid: process.env.IST_KID, privateKey, certificate: process.env.SERTIFIKA, signedAt: new Date().toISOString() });
  fs.writeFileSync(yml, withReleaseBlock(fs.readFileSync(yml, 'utf8'), token));
  process.exit(0);
}
process.exit(97);
`);
const ASAR_YAZ = (yol, dosyalar) => {
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
};
const BIN = path.join(GECICI, 'bin');
fs.mkdirSync(BIN);
for (const arac of ['ssh', 'scp', 'curl', 'npx']) {
  const y = path.join(BIN, arac);
  fs.writeFileSync(y, `#!/bin/sh\nexec "${process.execPath}" "${SAHTE}" ${arac} "$@"\n`);
  fs.chmodSync(y, 0o755);
}
const BELIRTEC = path.join(GECICI, 'yayin-belirteci');
fs.writeFileSync(BELIRTEC, `sahte-yayin-belirteci-${'x'.repeat(24)}\n`, { mode: 0o600 });
fs.chmodSync(BELIRTEC, 0o600);

/* ------------------------------------------------------------------ *
 * Geçici ağaç + ortak paket
 * ------------------------------------------------------------------ */
let sayac = 0;
const git = (agac, ...a) => execFileSync(GERCEK_GIT, ['-c', 'user.email=bekci@test', '-c', 'user.name=bekci', ...a], { cwd: agac, env: TEMIZ_ENV, encoding: 'utf8' }).trim();
const dizinKopya = (agac, rel) => fs.cpSync(path.join(KOK, rel), path.join(agac, rel), { recursive: true });
const dosyaKopya = (agac, rel, icerik) => {
  const h = path.join(agac, rel);
  fs.mkdirSync(path.dirname(h), { recursive: true });
  if (icerik !== undefined) fs.writeFileSync(h, icerik);
  else fs.copyFileSync(path.join(KOK, rel), h);
};

/** Senaryo ortamı: kendi sahte uzağı + çağrı günlüğü + gerçek betiğin kopyalandığı git ağacı + ortak paket. */
function ortam({ betik = null, capa = TEST_CAPA } = {}) {
  sayac += 1;
  const d = path.join(GECICI, `s${sayac}`);
  const uzak = path.join(d, 'uzak');
  for (const g of ['test', 'oncu', 'genel']) fs.mkdirSync(path.join(uzak, UZAK_KOK, 'html', g, 'electron'), { recursive: true });
  const log = path.join(d, 'cagri.jsonl');
  fs.writeFileSync(log, '');
  const agac = path.join(d, 'agac');
  for (const rel of ['scripts/lib', 'Electron/electron/guncelleme', 'Teks-Erp/scripts/test-profilleri']) dizinKopya(agac, rel);
  for (const rel of ['deploy/dagitim.json', 'deploy/kanallar.json', 'scripts/grup-yayin-kapisi.mjs', 'scripts/profil-matrisi-kapisi.mjs']) dosyaKopya(agac, rel);
  dosyaKopya(agac, 'deploy/electron-grup-yayinla.sh', betik ?? fs.readFileSync(path.join(KOK, 'deploy/electron-grup-yayinla.sh'), 'utf8'));
  fs.chmodSync(path.join(agac, 'deploy/electron-grup-yayinla.sh'), 0o755);
  // Sürüm notu / ortak kimlik kapılarının kendi bekçileri var; burada ölçülen onlar değil (beyanlı saplama).
  dosyaKopya(agac, 'scripts/check-surum-notlari.mjs', 'process.exit(0);\n');
  dosyaKopya(agac, 'scripts/panel-kimlik-kapisi.mjs', 'process.exit(0);\n');
  dosyaKopya(agac, 'Electron/electron/guncelleme/imza-capasi.json', `${JSON.stringify({ kokler: capa }, null, 2)}\n`);
  dosyaKopya(agac, 'Electron/package.json', `${JSON.stringify({ name: 'tekserp-panel', version: SURUM })}\n`);
  dosyaKopya(agac, '.gitignore', 'Electron/release/\n');
  git(agac, 'init', '-q');
  git(agac, 'add', '-A');
  git(agac, 'commit', '-q', '-m', 'taban');
  const bas = git(agac, 'rev-parse', 'HEAD');
  const paket = path.join(agac, 'Electron/release/ortak', SURUM);
  const res = path.join(paket, 'win-unpacked', 'resources');
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, 'app-update.yml'), `provider: generic\nurl: ${HOST}test/electron/\nchannel: latest\nupdaterCacheDirName: tekserp-panel-updater\n`);
  fs.writeFileSync(path.join(paket, 'win-unpacked', 'TeksERP.exe'), 'exe');
  ASAR_YAZ(path.join(res, 'app.asar'), {
    'package.json': JSON.stringify({ name: 'tekserp-panel', productName: 'TeksERP', version: SURUM, gitCommit: bas }),
    'out/main/main.js': `const panelKunyeTuru = "tekserp-panel"; const kokler = ${JSON.stringify(TEST_CAPA)};`,
    'out/renderer/index.html': '<title>TeksERP</title>',
  });
  const ad = `TeksERP-${SURUM}-Setup.exe`;
  const govde = crypto.randomBytes(4096);
  fs.writeFileSync(path.join(paket, ad), govde);
  fs.writeFileSync(path.join(paket, `${ad}.blockmap`), crypto.randomBytes(256));
  const sha = crypto.createHash('sha512').update(govde).digest('base64');
  fs.writeFileSync(path.join(paket, 'latest.yml'), `version: ${SURUM}\nfiles:\n  - url: ${ad}\n    sha512: ${sha}\n    size: ${govde.length}\npath: ${ad}\nsha512: ${sha}\n`);
  derlemeKunyesiYaz(path.join(paket, PANEL_KUNYE_ADI), { urun: 'panel', kanal: null, surum: SURUM, commit: bas, dosyaYolu: path.join(paket, ad), ek: { kimlik: 'ortak' } });
  return {
    d, uzak, log, agac, paket, ad, govde, bas,
    cagrilar: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s)),
    uzakDosya: (g, f) => path.join(uzak, UZAK_KOK, 'html', g, 'electron', f),
  };
}

const sifirAg = (o) => o.cagrilar().filter((c) => ['ssh', 'scp', 'curl', 'npx'].includes(c.arac)).length === 0;
const yazanAg = (o) => o.cagrilar().filter((c) => c.arac === 'scp');
const etiket = (o, ad, cumle) => git(o.agac, 'tag', '-a', ad, '-m', cumle);
const surumEtiketi = (o) => etiket(o, `panel-v${SURUM}`, `panel ${SURUM}`);
/** Kaynak grupta (ör. test) yayında sahte sürüm: aynı bayt (özet eşit) ya da farklı bayt. */
function grupaYayinla(o, g, { ayniBayt = true } = {}) {
  const y = (f) => o.uzakDosya(g, f);
  fs.writeFileSync(y(o.ad), ayniBayt ? o.govde : crypto.randomBytes(4096));
  fs.writeFileSync(y('latest.yml'), `version: ${SURUM}\n`);
}

function kos(o, args, { ortamEk = {}, anahtar = true } = {}) {
  const r = spawnSync('bash', [path.join(o.agac, 'deploy/electron-grup-yayinla.sh'), ...args, ...(anahtar ? ['--anahtar=sahte-anahtar'] : [])], {
    cwd: o.agac, encoding: 'utf8', input: '', timeout: 180_000,
    env: {
      ...TEMIZ_ENV,
      PATH: `${BIN}:${process.env.PATH}`,
      HOME: path.join(o.d, 'ev'),
      SAHTE_UZAK: o.uzak,
      CAGRI_LOG: o.log,
      TEKSERP_YAYIN_BELIRTECI: BELIRTEC,
      TEKSERP_YAYIN_BELIRTEC_KAYNAGI: path.join(GECICI, 'yok.json'),
      TEKSERP_YAYIN_BILDIRIMI: '0',
      GIT_CEILING_DIRECTORIES: GECICI,
      KUNYE_LIB: pathToFileURL(path.join(KOK, 'Electron/electron/guncelleme/panel-kunye.mjs')).href,
      YML_LIB: pathToFileURL(path.join(KOK, 'Electron/electron/guncelleme/latest-yml.mjs')).href,
      IST_PEM, IST_KID: IST.kid, KOK_KID: KOK_A.kid, SERTIFIKA,
      ...ortamEk,
    },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const kunyeKanali = (yolu) => {
  const p = parseLatestYml(fs.readFileSync(yolu, 'utf8'));
  if (!p.ok || p.value.tekserp === null) return null;
  for (const kanal of ['test', 'oncu', 'genel']) {
    if (verifyReleaseBlock(p.value.tekserp, { roots: TEST_CAPA, channel: kanal, nowMs: Date.now() }).ok) return kanal;
  }
  return null;
};

/* ------------------------------------------------------------------ *
 * §1 hüküm (saf)
 * ------------------------------------------------------------------ */
{
  const BAS = 'a'.repeat(40);
  const tag = (mesaj, commit = BAS) => ({ tur: 'tag', commit, mesaj });
  const git0 = (te, kaynakTe = null) => ({ bas: BAS, surumEtiketi: BAS, terfiEtiketi: te });
  const kaynaklar = [{ ne: 'panel latest.yml', url: 'u', durum: 'var', surum: '9.9.9' }];
  const hukum = (o) => grupTerfiHukmu({ grup: 'oncu', urun: 'panel', surum: '9.9.9', kaynak: 'test', git: git0(tag(ONAY_ONCU)), kaynaklar, ozet: { yerel: 'b'.repeat(64), kaynak: { durum: 'var', sha256: 'b'.repeat(64) } }, ...o });
  ol('§1 hepsi tamam → uyumlu (özet eşit)', hukum({}).sonuc === 'uyumlu');
  ol('§1 sonda: kaynak grup artefaktının özeti FARKLI → ihlal', hukum({ ozet: { yerel: 'b'.repeat(64), kaynak: { durum: 'var', sha256: 'c'.repeat(64) } } }).sonuc === 'ihlal');
  ol('§1 sonda: kaynak grupta artefakt YOK → ihlal', hukum({ ozet: { yerel: 'b'.repeat(64), kaynak: { durum: 'yok' } } }).sonuc === 'ihlal');
  ol('§1 sonda: kaynak özeti okunamadı → ÖLÇÜLEMEDİ (geçmiş sayılmaz)', hukum({ ozet: { yerel: 'b'.repeat(64), kaynak: { durum: 'olculemedi', neden: 'ssh' } } }).sonuc === 'olculemedi');
  ol('§1 sonda: terfi etiketi yok → ihlal', hukum({ git: git0(null) }).sonuc === 'ihlal');
  ol('§1 kök grup (kaynak yok) → terfi gerekmez', grupTerfiHukmu({ grup: 'test', urun: 'panel', surum: '9.9.9', kaynak: null, git: null, kaynaklar: null }).gerekmez === true);
  ol('§1 sonda: kök gruba kaçış cümlesi anlamsız → ihlal', grupTerfiHukmu({ grup: 'test', urun: 'panel', surum: '9.9.9', kaynak: null, git: null, kaynaklar: null, atla: KACIS }).sonuc === 'ihlal');
  const genel = (o) => grupTerfiHukmu({ grup: 'genel', urun: 'panel', surum: '9.9.9', kaynak: 'oncu', git: git0(tag(ONAY_GENEL)), kaynaklar, ozet: { yerel: 'b'.repeat(64), kaynak: { durum: 'var', sha256: 'b'.repeat(64) } }, kaynakOnay: { grup: 'oncu', etiket: tag(ONAY_ONCU) }, ...o });
  ol('§1 K-6: iki ayrı onay etiketi → uyumlu', genel({}).sonuc === 'uyumlu');
  ol('§1 K-6 sonda: kaynak grubun onay etiketi yok → ihlal', genel({ kaynakOnay: { grup: 'oncu', etiket: null } }).sonuc === 'ihlal');
  ol('§1 K-6 sonda: iki etiketin cümlesi AYNI → ihlal', genel({ git: git0(tag(ONAY_ONCU)) }).sonuc === 'ihlal');
  ol('§1 K-6 sonda: kaynak onay etiketi başka commit\'te → ihlal', genel({ kaynakOnay: { grup: 'oncu', etiket: tag(ONAY_ONCU, 'd'.repeat(40)) } }).sonuc === 'ihlal');
  ol('§1 kaçış: geçerli cümle → atlandı (özet/K-6 ölçülmez)', genel({ atla: KACIS }).atlandi?.cumle === KACIS);
}

/* ------------------------------------------------------------------ *
 * §2 hedef / grup (ağ yok)
 * ------------------------------------------------------------------ */
{
  const o = ortam();
  const r1 = kos(o, ['--grup=adnansahin', '--kuru']);
  ol('§2 eski kanal kodu (adnansahin) hedef olamaz → RED, ağ YOK', r1.kod !== 0 && /ESKİ KANAL/.test(r1.cikti) && sifirAg(o), r1.cikti);
  const r2 = kos(o, ['--grup=yok-grup', '--kuru']);
  ol('§2 bilinmeyen grup → RED, ağ YOK', r2.kod !== 0 && /kayıtlı bir güncelleme grubu değil/.test(r2.cikti) && sifirAg(o), r2.cikti);
  const r3 = kos(o, ['--musteri=adnansahin', '--kuru']);
  ol('§2 --musteri (eski kanal argümanı) bu betikte RED', r3.kod !== 0 && /eski kanal yayıncısının argümanı/.test(r3.cikti) && sifirAg(o), r3.cikti);
  const r4 = kos(o, ['--kuru']);
  ol('§2 --grup yoksa RED', r4.kod !== 0 && /--grup=/.test(r4.cikti) && sifirAg(o), r4.cikti);
  for (const ad of ['UZAK_DIZIN', 'SSH_HEDEF', 'YAYIN_URL']) {
    const r = kos(o, ['--grup=test', '--kuru'], { ortamEk: { [ad]: '/tmp/baska' } });
    ol(`§2 sonda: ortamda ${ad} ezmesi → RED, ağ YOK`, r.kod !== 0 && /EZİLEMEZ/.test(r.cikti) && sifirAg(o), r.cikti);
  }
  const r5 = kos(o, ['--grup=test', '--kuru', '--ssh=x']);
  ol('§2 sonda: tanınmayan seçenek (--ssh ezmesi) → RED', r5.kod !== 0 && /Tanınmayan seçenek/.test(r5.cikti) && sifirAg(o), r5.cikti);
  const r6 = kos(o, ['--grup=oncu', '--dogrula', '--terfi-atla=x']);
  ol('§2 --dogrula ile --terfi-atla birlikte RED', r6.kod !== 0 && sifirAg(o), r6.cikti);
}

/* ------------------------------------------------------------------ *
 * §3 test grubu — terfi etiketi İSTEMEZ
 * ------------------------------------------------------------------ */
{
  const o = ortam();
  const once = fs.readFileSync(path.join(o.paket, 'latest.yml'), 'utf8');
  const r = kos(o, ['--grup=test', '--kuru']);
  ol('§3 test grubu KURU: etiketsiz geçer (profil matrisi kök grup muaf), ağ YOK', r.kod === 0 && /KURU/.test(r.cikti) && sifirAg(o), r.cikti);
  ol('§3 KURU künyeyi imzalamaz ve ortak paketin latest.yml\'i değişmez', fs.readFileSync(path.join(o.paket, 'latest.yml'), 'utf8') === once && /İMZASIZ/.test(r.cikti), r.cikti);
  const kir = ortam();
  fs.appendFileSync(path.join(kir.agac, 'deploy/dagitim.json'), '\n');
  const rk = kos(kir, ['--grup=test', '--kuru']);
  ol('§3 sonda: kirli ağaç → RED (HEAD yayınlanan şey değil), ağ YOK', rk.kod !== 0 && /temiz değil/.test(rk.cikti) && sifirAg(kir), rk.cikti);
  const bag = ortam();
  fs.appendFileSync(path.join(bag.paket, `TeksERP-${SURUM}-Setup.exe`), 'X');
  const rb = kos(bag, ['--grup=test', '--kuru']);
  ol('§3 sonda: künyeden sonra değişen paket (özet tutmuyor) → RED', rb.kod !== 0 && /Derleme bağı/.test(rb.cikti) && sifirAg(bag), rb.cikti);

  // Gerçek (sahte uzak) yayın
  const y = ortam();
  const ortakYml = fs.readFileSync(path.join(y.paket, 'latest.yml'), 'utf8');
  const rg = kos(y, ['--grup=test']);
  const cagri = y.cagrilar();
  const scpler = cagri.filter((c) => c.arac === 'scp');
  const yukleme = scpler.map((c) => c.kaynaklar.join('+'));
  ol('§3 test grubu yayını: çıkış 0, ssh/scp/curl yalnız sahte uzağa', rg.kod === 0 && /OK — 'test' grubunda yayında/.test(rg.cikti) && !cagri.some((c) => c.YABANCI_AG), rg.cikti);
  ol('§3 yükleme sırası: paket + blockmap ÖNCE, latest.yml EN SON', yukleme.length === 2 && /Setup\.exe\+.*\.blockmap/.test(yukleme[0]) && yukleme[1] === 'latest.yml', JSON.stringify(yukleme));
  ol('§3 hedef yalnız test grubunun dizini (oncu/genel dizinine yazılmadı)', scpler.every((c) => c.hedef === `${UZAK_KOK}/html/test/electron/`) && !fs.existsSync(y.uzakDosya('oncu', 'latest.yml')) && !fs.existsSync(y.uzakDosya('genel', 'latest.yml')), JSON.stringify(scpler));
  ol('§3 yayındaki künyenin kanalı = TEST grubu', kunyeKanali(y.uzakDosya('test', 'latest.yml')) === 'test');
  ol('§3 ortak paketin kendi latest.yml\'i (künyesiz) DEĞİŞMEDİ', fs.readFileSync(path.join(y.paket, 'latest.yml'), 'utf8') === ortakYml);
  ol('§3 kenar okumaları belirteçli', cagri.filter((c) => c.arac === 'curl').length > 0 && cagri.filter((c) => c.arac === 'curl').every((c) => c.belirtec === true));
  ol('§3 sürüm etiketi atıldı (terfi zincirinin tabanı)', git(y.agac, 'tag', '--list', `panel-v${SURUM}`) === `panel-v${SURUM}`);
  ol('§3 defter yayın ağacının DIŞINDA (defter dizini)', fs.existsSync(path.join(y.uzak, UZAK_KOK, 'defter', 'test-panel-YAYIN-DEFTERI.tsv')));
  const ikinci = kos(y, ['--grup=test']);
  ol('§3 aynı bayt ikinci yayın idempotent (paket yeniden yüklenmez)', ikinci.kod === 0 && /AYNI baytlarla zaten var/.test(ikinci.cikti), ikinci.cikti);
  const dgr = kos(y, ['--grup=test', '--dogrula', `${SURUM}`]);
  ol('§3 --dogrula yükleme yapmadan künyeyi hedef grupla doğrular', dgr.kod === 0 && /künye geçerli|yayındaki künye geçerli/.test(dgr.cikti), dgr.cikti);
}

/* ------------------------------------------------------------------ *
 * §4 oncu / genel
 * ------------------------------------------------------------------ */
{
  // etiketsiz
  const e = ortam();
  const r1 = kos(e, ['--grup=oncu', '--kuru']);
  ol('§4 oncu KURU etiketsiz → RED (panel-vX ve terfi/oncu etiketi yok), ağ YOK', r1.kod !== 0 && /onay etiketi YOK/.test(r1.cikti) && sifirAg(e), r1.cikti);
  // etiketli ama profil matrisi raporu yok
  const p = ortam();
  surumEtiketi(p);
  etiket(p, `terfi/oncu/panel-v${SURUM}`, ONAY_ONCU);
  const r2 = kos(p, ['--grup=oncu', '--kuru']);
  ol('§4 etiketler tamam ama profil matrisi RAPORU yok → ÖLÇÜLEMEDİ = DUR, ağ YOK', r2.kod !== 0 && /profil matrisi kapısı/i.test(r2.cikti) && sifirAg(p), r2.cikti);
  const r3 = kos(p, ['--grup=oncu', '--kuru', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 kullanıcı cümleli profil kaçışı → KURU geçer', r3.kod === 0 && /KURU/.test(r3.cikti) && sifirAg(p), r3.cikti);
  const r3b = kos(p, ['--grup=oncu', '--kuru', '--profil-matrisi-atla=evet']);
  ol('§4 sonda: kısa profil kaçış cümlesi RED', r3b.kod !== 0 && sifirAg(p), r3b.cikti);

  // kaynak gruptan farklı özet
  const f = ortam();
  surumEtiketi(f);
  etiket(f, `terfi/oncu/panel-v${SURUM}`, ONAY_ONCU);
  grupaYayinla(f, 'test', { ayniBayt: false });
  const r4 = kos(f, ['--grup=oncu', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 sonda: kaynak grup (test) artefaktı FARKLI özet → RED, hiçbir şey yüklenmedi', r4.kod !== 0 && /FARKLI/.test(r4.cikti) && yazanAg(f).length === 0 && !fs.existsSync(f.uzakDosya('oncu', f.ad)), r4.cikti);
  // kaynak grupta yayın yok
  const k = ortam();
  surumEtiketi(k);
  etiket(k, `terfi/oncu/panel-v${SURUM}`, ONAY_ONCU);
  const r5 = kos(k, ['--grup=oncu', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 sonda: kaynak grupta (test) yayın YOK → RED, yükleme yok', r5.kod !== 0 && yazanAg(k).length === 0, r5.cikti);
  // kaynak gruba ulaşılamıyor → ÖLÇÜLEMEDİ
  const z = ortam();
  surumEtiketi(z);
  etiket(z, `terfi/oncu/panel-v${SURUM}`, ONAY_ONCU);
  const r6 = kos(z, ['--grup=oncu', `--profil-matrisi-atla=${KACIS}`], { ortamEk: { PATH: `${path.join(GECICI, 'kopuk')}:${process.env.PATH}` } });
  ol('§4 sonda: ssh yok/kopuk → yayın DURUR (ölçülemeyen şart geçmiş şart değil)', r6.kod !== 0 && yazanAg(z).length === 0, r6.cikti);

  // §5 başarılı terfi: bayt-eşit paket, künye yeniden imzalı
  const t = ortam();
  surumEtiketi(t);
  etiket(t, `terfi/oncu/panel-v${SURUM}`, ONAY_ONCU);
  grupaYayinla(t, 'test', { ayniBayt: true });
  fs.writeFileSync(t.uzakDosya('test', 'latest.yml'), `version: ${SURUM}\n`);
  const ortakOnce = { exe: fs.readFileSync(path.join(t.paket, t.ad)), yml: fs.readFileSync(path.join(t.paket, 'latest.yml'), 'utf8') };
  const r7 = kos(t, ['--grup=oncu', `--profil-matrisi-atla=${KACIS}`]);
  const sc = t.cagrilar().filter((c) => c.arac === 'scp');
  ol('§5 oncu terfisi: çıkış 0', r7.kod === 0 && /OK — 'oncu' grubunda yayında/.test(r7.cikti), r7.cikti);
  ol('§5 paket BAYT-EŞİT (oncu dizinindeki Setup = test dizinindeki Setup = ortak paket)',
    fs.existsSync(t.uzakDosya('oncu', t.ad)) && fs.readFileSync(t.uzakDosya('oncu', t.ad)).equals(fs.readFileSync(t.uzakDosya('test', t.ad))) && fs.readFileSync(t.uzakDosya('oncu', t.ad)).equals(ortakOnce.exe));
  ol('§5 künye hedef grupla yeniden imzalı (kanal = oncu; test künyesi oncu\'da geçmez)', kunyeKanali(t.uzakDosya('oncu', 'latest.yml')) === 'oncu');
  ol('§5 yükleme sırası: paket ÖNCE, latest.yml EN SON; yalnız oncu dizinine', sc.length === 2 && sc[1].kaynaklar.join() === 'latest.yml' && sc.every((c) => c.hedef === `${UZAK_KOK}/html/oncu/electron/`), JSON.stringify(sc));
  ol('§5 ortak paket ve test grubu DEĞİŞMEDİ', fs.readFileSync(path.join(t.paket, 'latest.yml'), 'utf8') === ortakOnce.yml && fs.readFileSync(t.uzakDosya('test', 'latest.yml'), 'utf8') === `version: ${SURUM}\n`);
  ol('§5 imza aracı hedef GRUP adıyla çağrıldı (--musteri=oncu)', t.cagrilar().some((c) => c.arac === 'npx' && /--musteri=oncu\b/.test(c.args)));

  // §4 K-6: genel
  const g = ortam();
  surumEtiketi(g);
  etiket(g, `terfi/genel/panel-v${SURUM}`, ONAY_GENEL);
  const r8 = kos(g, ['--grup=genel', '--kuru', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 K-6: genel için yalnız genel etiketi var, oncu onayı yok → RED', r8.kod !== 0 && /K-6/.test(r8.cikti) && sifirAg(g), r8.cikti);
  etiket(g, `terfi/oncu/panel-v${SURUM}`, ONAY_GENEL);
  const r9 = kos(g, ['--grup=genel', '--kuru', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 K-6: iki etiket AYNI cümleyi taşıyor → RED', r9.kod !== 0 && /AYNI/.test(r9.cikti) && sifirAg(g), r9.cikti);
  git(g.agac, 'tag', '-d', `terfi/oncu/panel-v${SURUM}`);
  etiket(g, `terfi/oncu/panel-v${SURUM}`, ONAY_ONCU);
  const r10 = kos(g, ['--grup=genel', '--kuru', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 K-6: iki AYRI onay cümlesi → KURU geçer', r10.kod === 0 && /KURU/.test(r10.cikti) && sifirAg(g), r10.cikti);
  // genel gerçek yayın: kaynak grup (oncu) yayında olmalı
  grupaYayinla(g, 'oncu', { ayniBayt: true });
  const r11 = kos(g, ['--grup=genel', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 genel terfisi (oncu yayında + iki onay): çıkış 0, künye kanalı = genel', r11.kod === 0 && kunyeKanali(g.uzakDosya('genel', 'latest.yml')) === 'genel', r11.cikti);
  // kaçış
  const ka = ortam();
  const r12 = kos(ka, ['--grup=oncu', '--kuru', `--terfi-atla=${KACIS}`, `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 --terfi-atla geçerli cümleyle KURU geçer (etiket aranmaz)', r12.kod === 0 && /KURU/.test(r12.cikti) && sifirAg(ka), r12.cikti);
  const r13 = kos(ka, ['--grup=oncu', '--kuru', '--terfi-atla=evet', `--profil-matrisi-atla=${KACIS}`]);
  ol('§4 sonda: kısa terfi kaçış cümlesi → RED', r13.kod !== 0 && sifirAg(ka), r13.cikti);
  const r14 = kos(ka, ['--grup=test', '--kuru', `--terfi-atla=${KACIS}`]);
  ol('§4 sonda: kök gruba (terfi kaynağı yok) kaçış verilemez → RED', r14.kod !== 0 && sifirAg(ka), r14.cikti);
}

/* ------------------------------------------------------------------ *
 * §6 betik kaynağı — kapı çağrıları ve sırası (negatif sondalı)
 * ------------------------------------------------------------------ */
function betikIhlalleri(metin) {
  const kod = metin.replace(/^\s*#.*$/gm, '');
  const f = [];
  const yer = (d) => kod.search(d);
  const ilkAg = Math.min(...[/^\s*scp /m].map(yer).filter((x) => x >= 0));
  for (const [ad, d] of [['profil matrisi kapısı', /profil-matrisi-kapisi\.mjs/], ['terfi kapısı', /grup-yayin-kapisi\.mjs" terfi /], ['derleme bağı', /grup-yayin-kapisi\.mjs" derleme-bagi /],
    ['sürüm notu kapısı', /check-surum-notlari\.mjs/], ['temiz ağaç', /grup-yayin-kapisi\.mjs" temiz-agac/], ['künye kapısı', /grup-yayin-kapisi\.mjs" imza /], ['rotasyon kilidi', /grup-yayin-kapisi\.mjs" rotasyon /],
    ['grup/eski kanal kapısı', /grup-yayin-kapisi\.mjs" grup /], ['hedef kayıttan', /grup-yayin-kapisi\.mjs" hedef /]]) {
    const i = yer(d);
    if (i < 0) f.push(`${ad} çağrısı YOK`);
    else if (i > ilkAg) f.push(`${ad} ilk yazan ağ işinden (scp) SONRA`);
  }
  const bel = kod.indexOf('baslikDosyasiYaz(');
  if (bel < 0 || bel > ilkAg) f.push('belirteç denetimi ilk ssh/scp\'den önce değil');
  const paketScp = kod.search(/^\s*scp -s "\$setup"/m);
  const latestScp = kod.search(/^\s*scp -s "\$latest"/m);
  if (paketScp < 0 || latestScp < 0 || paketScp > latestScp) f.push('latest.yml paketten ÖNCE yükleniyor (EN SON olmalı)');
  if (/\$\{(SSH_HEDEF|UZAK_DIZIN|YAYIN_KOK|YAYIN_URL|BASE_URL):?[-=]/.test(kod)) f.push('yayın hedefi ezme deseni');
  if (/yayin-hedefi/.test(kod)) f.push('hedef ESKİ kanal kaydından çözülüyor');
  if (/etikiliyazilim\.com|\/opt\/stack/.test(kod)) f.push('yayın/VDS kökü LİTERAL');
  if (!/--musteri=\*\|--musteri\)\s*hata/.test(kod)) f.push('--musteri reddi yok');
  if (/\bcurl\b/.test(kod.replace(/^belirtecli_curl\(\) \{ curl -H "@\$BELIRTEC_BASLIK" "\$@"; \}$/m, '').replace(/belirtecli_curl/g, ''))) f.push('belirteçsiz curl');
  return f;
}
{
  const gercek = fs.readFileSync(path.join(KOK, 'deploy/electron-grup-yayinla.sh'), 'utf8');
  const ih = betikIhlalleri(gercek);
  ol('§6 betik: bütün kapılar çağrılıyor ve ilk ağ işinden ÖNCE', ih.length === 0, ih.join('\n'));
  const mut = (ad, fn, beklenen) => {
    const m = fn(gercek);
    const r = betikIhlalleri(m);
    ol(`§6 sonda: ${ad} → KIRMIZI`, m !== gercek && r.some((x) => beklenen.test(x)), `${m === gercek ? 'MUTASYON UYGULANMADI' : ''} ${r.join(' | ')}`);
  };
  mut('profil matrisi kapısı çağrıları söküldü', (m) => m.replaceAll('profil-matrisi-kapisi.mjs', 'x-kapisi.mjs'), /profil matrisi kapısı çağrısı YOK/);
  mut('terfi kapısı söküldü', (m) => m.replace('grup-yayin-kapisi.mjs" terfi ', 'grup-yayin-kapisi.mjs" x '), /terfi kapısı çağrısı YOK/);
  mut('derleme bağı söküldü', (m) => m.replace('grup-yayin-kapisi.mjs" derleme-bagi ', 'grup-yayin-kapisi.mjs" x '), /derleme bağı çağrısı YOK/);
  mut('rotasyon kilidi söküldü', (m) => m.replace('grup-yayin-kapisi.mjs" rotasyon ', 'grup-yayin-kapisi.mjs" x '), /rotasyon kilidi çağrısı YOK/);
  mut('latest.yml paketten önce yükleniyor', (m) => m.replace('scp -s "$setup" "$blockmap"', 'scp -s "$latest" "$SSH_HEDEF:$UZAK_DIZIN/"\n  scp -s "$setup" "$blockmap"'), /EN SON/);
  mut('UZAK_DIZIN ezmesi geri geldi', (m) => `${m}\nUZAK_DIZIN="\${UZAK_DIZIN:-/x}"\n`, /ezme deseni/);
  mut('hedef eski kanal kaydından çözülüyor', (m) => `${m}\nnode x/kanal-kapisi.mjs yayin-hedefi a panel\n`, /ESKİ kanal kaydından/);
  mut('VDS kökü literal gömüldü', (m) => `${m}\nVDS=/opt/stack/apps/x\n`, /LİTERAL/);
  mut('çıplak curl', (m) => `${m}\ncurl -fsS https://x\n`, /belirteçsiz curl/);
  mut('--musteri reddi kalktı', (m) => m.replace('--musteri=*|--musteri) hata', '--musteri=*|--musteri) echo'), /--musteri reddi yok/);
}

/* ------------------------------------------------------------------ *
 * §7 kök çapası + rotasyon kilidi (KÖK düzeyi)
 * ------------------------------------------------------------------ */
/** Yayındaki latest.yml taklidi: v:2 künye, verilen `capa` listesiyle (imza rotasyon kapısında doğrulanmaz). */
const ESKI_GOVDE = Buffer.from('eski-surum');
const ESKI_AD = 'TeksERP-9.9.8-Setup.exe';
const ESKI_SHA = crypto.createHash('sha512').update(ESKI_GOVDE).digest('base64');
const ESKI_YML = `version: 9.9.8\nfiles:\n  - url: ${ESKI_AD}\n    sha512: ${ESKI_SHA}\n    size: ${ESKI_GOVDE.length}\npath: ${ESKI_AD}\nsha512: ${ESKI_SHA}\n`;
function yayindakiYml({ capa, kanal = 'test' }) {
  const doc = buildReleaseDoc({
    kanal, surum: '9.9.8', commit: 'abcdef0', yayinZamani: '2026-10-01T07:00:00.000Z',
    paket: { ad: ESKI_AD, boyut: ESKI_GOVDE.length, sha512: crypto.createHash('sha512').update(ESKI_GOVDE).digest('hex') }, capa,
  });
  return withReleaseBlock(ESKI_YML, signReleaseDoc({ doc, kid: IST.kid, privateKey: IST.privateKey, certificate: SERTIFIKA, signedAt: new Date().toISOString() }));
}
{
  const rot = (yayindaki, yeniKok = KOK_A.kid) => panelRotasyonDenetimi({ yayindaki, yeniKok });
  ol('§7 rotasyon: kanalda yayın yok → uyumlu', rot(null).sonuc === 'uyumlu');
  ol('§7 rotasyon: yayındaki künyesiz → uyumlu (ilk imzalı sürüm)', rot(ESKI_YML).sonuc === 'uyumlu');
  ol('§7 rotasyon: yeni kök yayındakinin çapasında → uyumlu', rot(yayindakiYml({ capa: [KOK_A.kid] })).sonuc === 'uyumlu');
  ol('§7 rotasyon: eski + yeni kök çapada, yeni kökle imza → uyumlu', rot(yayindakiYml({ capa: [KOK_A.kid, 'kok-2099-2'] }), 'kok-2099-2').sonuc === 'uyumlu');
  const yabanci = rot(yayindakiYml({ capa: [KOK_A.kid] }), 'kok-2099-2');
  ol('§7 sonda: yeni kök yayındakinin çapasında YOK → ihlal', yabanci.sonuc === 'ihlal' && /KURMAZLAR/.test(yabanci.satirlar.join(' ')), yabanci.satirlar.join('\n'));
  // v:1 künye: sahadaki eski panelin tanıdığı tek sürüm; v:2 imzayı BELGE_SURUM'la reddeder.
  const v1Bildirim = hamJws('tekserp-panel', IST, { v: 1, urun: 'panel', kanal: 'test', surum: '9.9.8', capa: [KOK_A.kid] });
  const v1 = rot(`${ESKI_YML}tekserp:\n  v: 1\n  bildirim: ${v1Bildirim}\n`);
  ol('§7 sonda: yayındaki künye v:1 → ihlal (BELGE_SURUM)', v1.sonuc === 'ihlal' && /BELGE_SURUM/.test(v1.satirlar.join(' ')), v1.satirlar.join('\n'));

  // Uçtan uca: yayındaki sürümün çapası yeni imzanın kökünü taşımıyor → hiçbir şey yüklenmez.
  const r = ortam();
  fs.writeFileSync(r.uzakDosya('test', 'latest.yml'), yayindakiYml({ capa: ['kok-2099-9'] }));
  const rr = kos(r, ['--grup=test']);
  ol('§7 sonda: yayındaki çapada kök yok → ROTASYON KİLİDİ, hiçbir şey yüklenmedi', rr.kod !== 0 && /ROTASYON KİLİDİ/.test(rr.cikti) && yazanAg(r).length === 0 && !fs.existsSync(r.uzakDosya('test', r.ad)), rr.cikti);

  // Fikstür kökü (üretim biçimi dışı) gömülmüş panel yayınlanmaz: hiçbir üretim imzasını doğrulayamaz.
  const f = ortam({ capa: [{ kid: 'kok-fikstur-1', x: KOK_A.x, classes: SINIFLAR }] });
  const rf = kos(f, ['--grup=test', '--kuru']);
  ol('§7 sonda: çapada üretim biçimi dışı kök → RED, ağ YOK', rf.kod !== 0 && sifirAg(f) && /CAPA_GECERSIZ/.test(rf.cikti), rf.cikti);
  const bos = ortam({ capa: [] });
  const rb = kos(bos, ['--grup=test', '--kuru']);
  ol('§7 sonda: boş kök çapası → RED, ağ YOK', rb.kod !== 0 && sifirAg(bos) && /CAPA_BOS/.test(rb.cikti), rb.cikti);
}

/* ------------------------------------------------------------------ *
 * §8 yıllık tören (I7): yeniden imzalı künye yayın kapısından geçer · 30 gün kapısı GERÇEK araçla yayın yolunda
 * ------------------------------------------------------------------ */
{
  console.log('\n§8 yıllık tören — yeniden imzalı künye (gerçek yeniden-imzala) · 30 gün kapısı (gerçek imzala, yayın betiğinden)');
  const TEKS = path.join(KOK, 'Teks-Erp');
  const d8 = path.join(GECICI, 'toren8');
  fs.mkdirSync(d8, { mode: 0o700 });
  const tsx = (argv, input = '') => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/panel-imza.ts', ...argv], { cwd: TEKS, encoding: 'utf8', input, timeout: 120_000, env: { ...TEMIZ_ENV, HOME: path.join(d8, 'ev') } });
  const PAROLA8 = `bekci-toren-${crypto.randomBytes(8).toString('hex')}`;
  const parolaDosyasi = path.join(d8, 'parola.txt');
  fs.writeFileSync(parolaDosyasi, `${PAROLA8}\n`, { mode: 0o600 });
  const anahtarDosyasi = (kid, gun) => {
    const dizin = path.join(d8, kid);
    fs.mkdirSync(dizin, { mode: 0o700 });
    const u = tsx(['anahtar-uret', `--kid=${kid}`, `--dizin=${dizin}`, '--json'], `${PAROLA8}\n${PAROLA8}\n`);
    if (u.status !== 0) return { hata: u.stderr };
    const k = JSON.parse(u.stdout.trim().split('\n').pop());
    const sertifika = hamJws('tekserp-sertifika', KOK_A, {
      v: 1, sertifikaId: crypto.randomUUID(), kullanim: 'ISTEMCI', kid, x: k.x, siniflar: ['URETIM'],
      baslangic: new Date(Date.now() - GUN_MS).toISOString(), bitis: new Date(Date.now() + gun * GUN_MS).toISOString(), bayi: null,
    });
    fs.writeFileSync(path.join(dizin, `${kid}.sertifika.json`), JSON.stringify({ sertifika }), { mode: 0o600 });
    return { dosya: k.dosya, x: k.x };
  };
  const yeni = anahtarDosyasi('ist-2099-2', 395);
  const capaDosyasi = path.join(d8, 'capa.json');
  fs.writeFileSync(capaDosyasi, JSON.stringify({ kokler: TEST_CAPA }));
  const yayinda = path.join(d8, 'yayindaki.yml');
  fs.writeFileSync(yayinda, yayindakiYml({ capa: [KOK_A.kid] }));
  const cikti = path.join(d8, 'yeniden.yml');
  const r = tsx(['yeniden-imzala', `--latest=${yayinda}`, '--musteri=test', `--anahtar=${yeni.dosya}`, `--capa=${capaDosyasi}`, `--cikti=${cikti}`, `--parola-dosyasi=${parolaDosyasi}`]);
  const yeniMetin = fs.existsSync(cikti) ? fs.readFileSync(cikti, 'utf8') : '';
  const p = parseLatestYml(yeniMetin);
  const v = p.ok ? verifyReleaseBlock(p.value.tekserp, { roots: TEST_CAPA, channel: 'test', nowMs: Date.now() }) : p;
  ol('§8a gerçek `yeniden-imzala` (parola dosyasıyla): yayındaki künye yeni ist-2099-2 imzasıyla panel doğrulayıcısından geçer, paket kaydı aynen',
    r.status === 0 && v.ok && v.value.kid === 'ist-2099-2' && yeniMetin.split('\ntekserp:')[0] === fs.readFileSync(yayinda, 'utf8').split('\ntekserp:')[0], `${r.status} ${r.stderr}${yeni.hata ?? ''} ${v.code ?? ''}`);
  const rot = panelRotasyonDenetimi({ yayindaki: yeniMetin, yeniKok: KOK_A.kid });
  ol('§8b yeniden imzalı künye yayındayken sonraki yayın (aynı kök) → rotasyon kilidi uyumlu', rot.sonuc === 'uyumlu', rot.satirlar?.join('\n'));

  // 30 gün kapısı: yayın betiği GERÇEK imza aracını çağırır; bitişe 29 gün kalmış sertifikayla künye imzalanmaz, yükleme yok.
  const yayinKos = (a) => {
    const o = ortam();
    return { o, k: kos(o, ['--grup=test', `--anahtar=${a.dosya}`], { anahtar: false, ortamEk: { GERCEK_PANEL_IMZA: TEKS, GERCEK_PAROLA_DOSYASI: parolaDosyasi } }) };
  };
  const g29 = yayinKos(anahtarDosyasi('ist-2099-3', 29));
  ol('§8c ⭐ 30 gün kapısı yayın yolunda: bitişe 29 gün kalan ISTEMCI sertifikası → gerçek imza aracı RED, betik durur, hiçbir şey YÜKLENMEDİ',
    g29.k.kod !== 0 && /< 30\) — bununla İMZALANMAZ/.test(g29.k.cikti) && /Künye imzalanamadı/.test(g29.k.cikti) && yazanAg(g29.o).length === 0 && !fs.existsSync(g29.o.uzakDosya('test', g29.o.ad)), g29.k.cikti.slice(-600));
  const g90 = yayinKos(anahtarDosyasi('ist-2099-4', 90));
  ol('§8c\' ✓K kapı kör değil: 90 günlük sertifikada aynı yol 30 gün iletisini BASMAZ (gerçek araç kapıyı geçer; gerçek üretim çapası test kökünü tanımaz → yine yükleme yok)',
    g90.k.kod !== 0 && !/< 30\)/.test(g90.k.cikti) && /KOK_BILINMIYOR|SERTIFIKA_GECERSIZ/.test(g90.k.cikti) && /Künye imzalanamadı/.test(g90.k.cikti) && yazanAg(g90.o).length === 0 && g90.o.cagrilar().some((c) => c.arac === 'npx' && c.gercek), g90.k.cikti.slice(-600));
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
if (kaldi.length) {
  console.log(`Kırmızı: ${kaldi.join(' | ')}`);
  process.exit(1);
}
