#!/usr/bin/env node
// =============================================================================
// BEKÇİ — yayın betiklerinin KANAL KAPILARI (K2/K4) · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// Yayın betiklerini GERÇEKTEN koşturur, ama dünyaya dokunmadan: PATH'in önüne
// sahte `ssh` · `scp` · `curl` · `git` · `npm` · `npx` konur.
//   ssh/scp → geçici bir "sahte uzak" dizine (komutlar yol yeniden yazılarak orada koşar)
//   curl    → yalnız guncelleme.etkiliyazilim.com, sahte uzaktan cevaplanır; başka her
//             adres KIRMIZI (ağa çıkma girişimi)
//   git     → okuma serbest, `tag -a`/`push` ENGELLENİR ve kaydedilir
//   npm     → `run build:win*` electron-builder'ın KİMLİK çıktılarını package.json'dan
//             üretir (app-update.yml url + updaterCacheDirName, exe adı, latest.yml)
//   npx     → kaydedilir, 0 döner (paketlemenin vitest adımı; ayrı bekçisi var)
// Kabuk betikleri (electron-*.sh) geçici bir ağaç KOPYASINDA koşar — gerçek
// `Electron/release/`e ve musteri.json'a dokunulmaz. mobil-yayinla.mjs `--kuru`,
// yayinla-ota.mjs `--check` ile gerçek ağaçtan koşar (ikisi de o kiplerde yazmaz).
//
// NE ÖLÇER:
//   §1 electron-yayinla.sh — hedef PAKETİN kimliğinden; niyet (--musteri) ≠ paket → ssh'tan ÖNCE dur
//   §2 electron-paketle.sh — bilinmeyen kanal / kimliği ağaçta olmayan kanal → hiçbir dosya yazılmadan dur;
//      adnansahin paketlemesi dinlenmedeki dosyaları BAYT BAYT aynı bırakır, çıktı release/<kod>/<sürüm>
//   §3 mobil-yayinla.mjs — OTA künye/bundle ve APK bundle ERP adresi kanalın adresi değilse dur;
//      okunamayan bundle/manifest ÖLÇÜLEMEDİ = dur; --kuru etiket atmaz
//   §4 yayinla-ota.mjs — çözülen ERP adresi kanalın değilse ağdan ÖNCE dur
//   §5 yüklemler (lib): zip okuyucu, bundle ölçümü, tablet kimliği
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
import { fileURLToPath } from 'node:url';

import { kanalCoz, tabletSabitKimlikFarki, panelSabitKimlikFarki, dosyalariOku, TABLET_SABIT_DOSYALAR, PANEL_SABIT_DOSYALAR } from './lib/kanallar.mjs';
import { bundleAdresOlcumu } from '../mobil/scripts/lib/adres.mjs';
import { zipGirdisiOku } from '../mobil/scripts/lib/zip.mjs';

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
const TEMIZ_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

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
  if (/^bash -s\b/.test(komut)) { stdinOku(); yaz({ host, komut, tur: 'budama' }); process.exit(0); }
  yaz({ host, komut });
  const r = spawnSync('bash', ['-c', komut.replaceAll('/opt/stack', UZAK + '/opt/stack')], { encoding: 'utf8' });
  process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? '');
  process.exit(r.status ?? 1);
}
if (arac === 'scp') {
  const k = a.filter((x, i) => x !== '-r' && x !== '-P' && a[i - 1] !== '-P');
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
  yaz({ url: tem, bas });
  if (!tem.startsWith(HOST)) { yaz({ YABANCI_AG: tem }); process.exit(6); }
  const dosya = uzakYol('/opt/stack/apps/tekserp-guncelleme/html/' + tem.slice(HOST.length));
  const var_ = fs.existsSync(dosya) && fs.statSync(dosya).isFile();
  if (bicim) {
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
  yaz({ args: a.join(' ') });
  if (a[0] !== 'run' || !/^build:win/.test(a[1] ?? '')) process.exit(0);
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const cikti = p.build.directories.output.replaceAll('$' + '{version}', p.version);
  const res = path.join(cikti, 'win-unpacked', 'resources');
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, 'app-update.yml'),
    'provider: generic\nurl: ' + p.build.publish[0].url + '\nchannel: latest\nupdaterCacheDirName: ' + p.name + '-updater\n');
  fs.writeFileSync(path.join(cikti, 'win-unpacked', p.build.productName + '.exe'), 'SAHTE ' + p.name);
  const exe = 'TeksERP-' + p.version + '-Setup.exe';
  const govde = Buffer.from('SAHTE-SETUP ' + p.name + ' ' + p.version + ' ' + p.build.publish[0].url);
  fs.writeFileSync(path.join(cikti, exe), govde);
  fs.writeFileSync(path.join(cikti, exe + '.blockmap'), 'SAHTE-BLOCKMAP');
  const sha = crypto.createHash('sha512').update(govde).digest('base64');
  fs.writeFileSync(path.join(cikti, 'latest.yml'),
    'version: ' + p.version + '\nfiles:\n  - url: ' + exe + '\n    sha512: ' + sha + '\n    size: ' + govde.length + '\npath: ' + exe + '\nsha512: ' + sha + '\n');
  process.exit(0);
}
process.exit(97);
`);
const BIN = path.join(GECICI, 'bin');
fs.mkdirSync(BIN);
for (const arac of ['ssh', 'scp', 'curl', 'git', 'npm', 'npx']) {
  const y = path.join(BIN, arac);
  fs.writeFileSync(y, `#!/bin/sh\nexec "${process.execPath}" "${SAHTE}" ${arac} "$@"\n`);
  fs.chmodSync(y, 0o755);
}

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

function kos(o, komut, argumanlar, { cwd, girdi } = {}) {
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
      SSH_HEDEF: 'sahte-hedef',
      GIT_CEILING_DIRECTORIES: GECICI,
    },
  });
  return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const agText = (o) => o.cagrilar().filter((c) => c.arac === 'ssh' || c.arac === 'scp');
const yabanciAg = (o) => o.cagrilar().filter((c) => c.YABANCI_AG);

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
  ...PANEL_SABIT_DOSYALAR,
];
function agacKur(o, { ref = null } = {}) {
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
  return agac;
}

/** Sahte panel derlemesi — electron-builder'ın kimlik taşıyan çıktıları. */
function panelArtefakti(dizin, { url, cache, exe, surum }) {
  const res = path.join(dizin, 'win-unpacked', 'resources');
  fs.mkdirSync(res, { recursive: true });
  if (url) fs.writeFileSync(path.join(res, 'app-update.yml'), `provider: generic\nurl: ${url}\nchannel: latest\nupdaterCacheDirName: ${cache}\n`);
  fs.writeFileSync(path.join(dizin, 'win-unpacked', exe), 'exe');
  const ad = `TeksERP-${surum}-Setup.exe`;
  const govde = crypto.randomBytes(4096);
  fs.writeFileSync(path.join(dizin, ad), govde);
  fs.writeFileSync(path.join(dizin, `${ad}.blockmap`), crypto.randomBytes(256));
  const sha = crypto.createHash('sha512').update(govde).digest('base64');
  fs.writeFileSync(path.join(dizin, 'latest.yml'),
    `version: ${surum}\nfiles:\n  - url: ${ad}\n    sha512: ${sha}\n    size: ${govde.length}\npath: ${ad}\nsha512: ${sha}\n`);
}
const ADNANSAHIN_PANEL = { url: `${YAYIN_HOST}adnansahin/electron/`, cache: 'adnan-sahin-erp-admin-updater', exe: 'Adnan Şahin ERP.exe' };
const TESTFABRIKA_PANEL = { url: `${YAYIN_HOST}testfabrika/electron/`, cache: 'teks-erp-testfabrika-updater', exe: 'TeksERP Test Fabrika.exe' };

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
    if (c.arac === 'ssh') {
      if (/sha256sum/.test(c.komut)) return `ssh sha256-sorgu ${/'([^']+)'/.exec(c.komut)?.[1]}`;
      if (/openssl dgst/.test(c.komut)) return `ssh sha512 ${/'([^']+)'/.exec(c.komut)?.[1]}`;
      if (/YAYIN-DEFTERI/.test(c.komut)) return `ssh defter ${/>> '([^']+)'/.exec(c.komut)?.[1]}`;
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

function yayinSenaryosu({ ref = null, musteriArg = '--musteri=adnansahin', artefakt = ADNANSAHIN_PANEL, dizin = 'adnansahin', surum = '9.9.9', ekArg = [] } = {}) {
  const o = ortam();
  const agac = agacKur(o, { ref });
  const rel = ref ? path.join(agac, 'Electron/release', surum) : path.join(agac, 'Electron/release', dizin, surum);
  if (artefakt) panelArtefakti(rel, { ...artefakt, surum });
  const args = [musteriArg, surum, ...ekArg].filter(Boolean);
  const r = kos(o, path.join(agac, 'deploy/electron-yayinla.sh'), args, { cwd: agac });
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
  ol('1a uzakta üç dosya, başka kanala tek bayt yok',
    Object.keys(u).filter((k) => k.includes('/html/')).sort().join(',') ===
      [`${kok}/TeksERP-9.9.9-Setup.exe`, `${kok}/TeksERP-9.9.9-Setup.exe.blockmap`, `${kok}/latest.yml`].join(','),
    Object.keys(u).join('\n'));
  ol('1a yayın defteri adnansahin-YAYIN-DEFTERI.tsv (html/ DIŞINDA)', Object.keys(u).includes(`${VDS}/defter/adnansahin-YAYIN-DEFTERI.tsv`));
  ol('1a sha512 sunucuda doğrulandı + budama + etiket girişimi (engellendi)',
    sirali.includes(`ssh sha512 ${kok}/TeksERP-9.9.9-Setup.exe`) && sirali.some((s) => s.startsWith(`ssh budama ${kok} 9.9.9`)) &&
      sirali.includes('git tag -a panel-v9.9.9 (engellendi)'), sirali.join('\n'));
  ol('1a ağ: yalnız yayın sunucusunun adnansahin yolu', yabanciAg(o).length === 0 &&
    o.cagrilar().filter((c) => c.arac === 'curl').every((c) => c.url.startsWith(`${YAYIN_HOST}adnansahin/electron/`)));

  if (ESKI) {
    const e = yayinSenaryosu({ ref: ESKI, musteriArg: null });
    const izEski = iz(e.o);
    const izYeni = iz(o);
    const fark = izEski.length !== izYeni.length ? ['uzunluk'] : izEski.filter((s, i) => s !== izYeni[i]);
    ol(`1a⇄${ESKI} ESKİ betik (argümansız, ağaçtaki musteri.json) ile YENİ betik (--musteri) aynı izi bırakır`,
      e.r.kod === 0 && fark.length === 0, `eski çıkış ${e.r.kod}\nESKİ:\n${izEski.join('\n')}\nYENİ:\n${izYeni.join('\n')}`);
    const uE = Object.keys(uzakAgaci(e.o)).sort();
    ol(`1a⇄${ESKI} uzaktaki dosya kümesi aynı`, uE.join(',') === Object.keys(u).sort().join(','), `${uE.join('\n')}\n--\n${Object.keys(u).sort().join('\n')}`);
  }
}

{
  // B3: testfabrika derlemesi adnansahin klasöründe kalmış (ya da oraya kopyalanmış), niyet adnansahin.
  const { o, r } = yayinSenaryosu({ artefakt: TESTFABRIKA_PANEL, dizin: 'adnansahin' });
  ol('1b testfabrika paketi + --musteri=adnansahin → DUR, ssh/scp SIFIR',
    r.kod !== 0 && agText(o).length === 0 && /testfabrika/.test(r.cikti), r.cikti.slice(-500));
  if (ESKI) {
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
  ol('1i --dogrula (salt denetim) → çıkış 0, ssh/scp SIFIR', r.kod === 0 && agText(o).length === 0 && /OK — yayında: 9\.9\.8/.test(r.cikti), r.cikti.slice(-400));
}

/* ------------------------------------------------------------------ *
 * §2 electron-paketle.sh (sahte derleyici)
 * ------------------------------------------------------------------ */

console.log('\n§2 — electron-paketle.sh: dosya yazmadan kanal kapısı, çıktı kanala ayrık');

const IZLENEN = ['Electron/package.json', 'Electron/shared/musteri.json'];
const ozet = (agac) => IZLENEN.map((rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(agac, rel))).digest('hex')).join(',');

function paketleSenaryosu(argumanlar, { ref = null } = {}) {
  const o = ortam();
  const agac = agacKur(o, { ref });
  const once = ozet(agac);
  const r = kos(o, path.join(agac, 'deploy/electron-paketle.sh'), argumanlar, { cwd: agac });
  return { o, r, agac, once, sonra: ozet(agac) };
}
{
  const s = paketleSenaryosu(['testfabirka', '9.9.9']);
  ol('2a bilinmeyen kanal → DUR, package.json/musteri.json DEĞİŞMEDİ, derleme YOK',
    s.r.kod !== 0 && s.once === s.sonra && !s.o.cagrilar().some((c) => c.arac === 'npm') && /BİLİNMEYEN KANAL/.test(s.r.cikti), s.r.cikti);
}
{
  const s = paketleSenaryosu(['testfabrika', '9.9.9']);
  ol('2b kimliği ağaçta olmayan kanal (testfabrika, D2 öncesi) → DUR, dosya DEĞİŞMEDİ, derleme YOK',
    s.r.kod !== 0 && s.once === s.sonra && !s.o.cagrilar().some((c) => c.arac === 'npm') && /PANEL KİMLİĞİNİ TAŞIMIYOR/.test(s.r.cikti), s.r.cikti.slice(0, 600));
}
{
  const surum = JSON.parse(fs.readFileSync(path.join(KOK, 'Electron/package.json'), 'utf8')).version;
  const s = paketleSenaryosu(['adnansahin', surum]);
  const yml = path.join(s.agac, 'Electron/release/adnansahin', surum, 'win-unpacked/resources/app-update.yml');
  ol(`2c adnansahin ${surum} → çıkış 0, çıktı release/adnansahin/${surum}/`, s.r.kod === 0 && fs.existsSync(yml), s.r.cikti.slice(-600));
  ol('2c dinlenmedeki package.json + musteri.json BAYT BAYT aynı kaldı (adnansahin için sıfır fark)', s.once === s.sonra);
  ol('2c gömülü kimlik bugünkü: url …/adnansahin/electron/ · adnan-sahin-erp-admin-updater · "Adnan Şahin ERP.exe"',
    fs.existsSync(yml) && fs.readFileSync(yml, 'utf8').includes(`url: ${YAYIN_HOST}adnansahin/electron/`) &&
      fs.readFileSync(yml, 'utf8').includes('updaterCacheDirName: adnan-sahin-erp-admin-updater') &&
      fs.existsSync(path.join(path.dirname(path.dirname(yml)), 'Adnan Şahin ERP.exe')));
  ol('2c yayın komutu önerisi --musteri taşıyor', /electron-yayinla\.sh --musteri=adnansahin/.test(s.r.cikti));
  if (ESKI) {
    const e = paketleSenaryosu(['adnansahin', surum], { ref: ESKI });
    const eYml = path.join(e.agac, 'Electron/release', surum, 'win-unpacked/resources/app-update.yml');
    ol(`2c⇄${ESKI} ESKİ paketleme aynı gömülü kimliği üretir (app-update.yml birebir, exe adı aynı)`,
      e.r.kod === 0 && fs.existsSync(eYml) && fs.readFileSync(eYml, 'utf8') === fs.readFileSync(yml, 'utf8') &&
        fs.readdirSync(path.join(path.dirname(path.dirname(eYml)))).join() === fs.readdirSync(path.dirname(path.dirname(yml))).join(),
      e.r.cikti.slice(-400));
    const pE = JSON.parse(fs.readFileSync(path.join(e.agac, 'Electron/package.json'), 'utf8'));
    const pY = JSON.parse(fs.readFileSync(path.join(s.agac, 'Electron/package.json'), 'utf8'));
    pE.build.directories.output = pY.build.directories.output = '<ayrık>';
    ol(`2c⇄${ESKI} paketlemenin yazdığı package.json çıktı dizini DIŞINDA birebir`, JSON.stringify(pE) === JSON.stringify(pY));
  }
}

/* ------------------------------------------------------------------ *
 * §3 mobil-yayinla.mjs (--kuru, gerçek ağaç)
 * ------------------------------------------------------------------ */

console.log('\n§3 — mobil-yayinla.mjs: ERP adresi kanalın adresi mi (OTA + APK)');

function otaPaketi(o, { adres = FABRIKA_ERP, bundleAdres = FABRIKA_ERP, kanal = 'adnansahin', bundleYok = false, ekAdres = null } = {}) {
  const damga = '1790000000000';
  const d = path.join(o.d, 'ota', kanal, '54.2', damga);
  const bundle = '_expo/static/js/android/index-sahte.hbc';
  fs.mkdirSync(path.join(d, path.dirname(bundle)), { recursive: true });
  if (!bundleYok) fs.writeFileSync(path.join(d, bundle), `\x00\x01hermes${bundleAdres}\x00${ekAdres ?? ''}\x00son`, 'latin1');
  const kunye = { musteri: kanal, runtimeVersion: '54.2', damga, bundle, manifestId: 'sahte-id', imzali: true };
  if (adres !== undefined) kunye.adres = adres;
  fs.writeFileSync(path.join(d, 'yayin.json'), JSON.stringify(kunye));
  const man = `{"id":"sahte-id","launchAsset":{"url":"${YAYIN_HOST}${kanal}/mobil/ota/54.2/${damga}/${bundle}"}}`;
  fs.writeFileSync(path.join(d, 'manifest'), man);
  fs.writeFileSync(path.join(d, `manifest-${damga}`), man);
  return d;
}
const mobilYayinla = (o, args) => kos(o, process.execPath, [path.join(KOK, 'deploy/mobil-yayinla.mjs'), ...args, '--kuru'], { cwd: KOK });
const etiketGirisimi = (o) => o.cagrilar().some((c) => c.ENGELLENDI);

{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--paket=${otaPaketi(o)}`]);
  ol('3a adnansahin OTA (künye + bundle fabrika adresi) --kuru → çıkış 0', r.kod === 0 && /ERP adresi {5}: http:\/\/192\.168\.1\.250:4000\/api/.test(r.cikti), r.cikti.slice(-600));
  ol('3a --kuru etiket ATMAZ (git tag/push girişimi yok)', !etiketGirisimi(o) && /\[kuru\] sürüm etiketi atılmadı/.test(r.cikti));
  ol('3a --kuru hiçbir şeyi gerçekten yüklemez (ssh/scp çağrısı yok)', agText(o).length === 0);
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
function apk(o, { feed = `${YAYIN_HOST}adnansahin/mobil/`, erp = FABRIKA_ERP, bundleYok = false, manifestUrlYok = false } = {}) {
  const y = path.join(o.d, `sahte-${sayac}.apk`);
  const man = Buffer.from(`\u0000android\u0000${manifestUrlYok ? 'bos' : `${feed}ota/54.2/manifest`}\u0000`, 'utf16le');
  const g = [{ ad: 'AndroidManifest.xml', veri: man, yontem: 8 }];
  if (!bundleYok) g.push({ ad: 'assets/index.android.bundle', veri: Buffer.from(`hermes\u0000${erp}\u0000son`, 'latin1'), yontem: 0 });
  zipYaz(y, g);
  return y;
}
const tabletSurum = JSON.parse(fs.readFileSync(path.join(KOK, 'mobil/app.json'), 'utf8')).expo.version;
{
  const o = ortam();
  const r = mobilYayinla(o, ['--musteri=adnansahin', `--apk=${apk(o)}`, `--surum=${tabletSurum}`, '--vc=57']);
  ol(`3g adnansahin APK (manifest + bundle fabrika) --kuru --surum=${tabletSurum} → çıkış 0, etiket yok`,
    r.kod === 0 && /APK içindeki adres: https:\/\/guncelleme\.etkiliyazilim\.com\/adnansahin\/mobil\/ota\/54\.2\/manifest/.test(r.cikti) &&
      !etiketGirisimi(o) && agText(o).length === 0, r.cikti.slice(-700));
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

/* ------------------------------------------------------------------ *
 * §4 yayinla-ota.mjs --check (ağsız argümanlarla)
 * ------------------------------------------------------------------ */

console.log('\n§4 — yayinla-ota.mjs: ERP adresi ağdan ÖNCE kanalla kıyaslanır');

// Ağ yok: sürüm elle (etiket/yayın okuması atlanır), künye adresi 127.0.0.1:9 (bağlantı reddi).
const otaCheck = (o, apiUrl) => kos(o, process.execPath, [path.join(KOK, 'mobil/scripts/yayinla-ota.mjs'),
  '--musteri=adnansahin', `--api-url=${apiUrl}`, '--check', `--surum=${tabletSurum}`, '--update-url=http://127.0.0.1:9/'], { cwd: path.join(KOK, 'mobil') });
{
  const o = ortam();
  const r = otaCheck(o, FABRIKA_ERP);
  ol('4a fabrika adresi + --musteri=adnansahin → kanal kapısı geçer (bugünkü komut aynen çalışır)',
    /Kanal {13}: adnansahin \(uretim\)/.test(r.cikti) && !/KANALININ DEĞİL/.test(r.cikti), r.cikti.slice(0, 800));
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

/* ------------------------------------------------------------------ *
 * §5 yüklemler
 * ------------------------------------------------------------------ */

console.log('\n§5 — ortak yüklemler');
{
  const d = dosyalariOku([...TABLET_SABIT_DOSYALAR, ...PANEL_SABIT_DOSYALAR]);
  ol('5a adnansahin: ağacın panel + tablet kimliği kayıtla birebir',
    panelSabitKimlikFarki(kanalCoz('adnansahin').kanal, d).length === 0 && tabletSabitKimlikFarki(kanalCoz('adnansahin').kanal, d).length === 0);
  const tf = tabletSabitKimlikFarki(kanalCoz('testfabrika').kanal, d);
  ol('5b testfabrika: tablet kimliği ağaçta YOK (D3 öncesi OTA üretimi kapalı: paket adı + sertifika)',
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
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi.length} başarısız ===`);
if (kaldi.length) for (const a of kaldi) console.log(`   · ${a}`);
process.exit(kaldi.length ? 1 : 0);
