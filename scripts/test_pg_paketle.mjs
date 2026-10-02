#!/usr/bin/env node
// =============================================================================
// BEKÇİ — PG PAKETİ ÜRETİMİ (deploy/pg/pg-paketle.mjs) · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// setup.exe'nin yanına giden `postgresql-<surum>-<derleme>-tekserp.zip` bu betikten doğar; kurulumda
// (tekserp-guncelleyici kurulum-pg) hedef dizine OLDUĞU GİBİ açılır ve kökteki manifestoya karşı ölçülür.
// Betik GÖLGE bir kökte GERÇEK süreç olarak koşar: deploy/pg kopyası + küçük sahte EDB zip'i + o zip'e göre
// yazılmış sahte kayıt (yapısı gerçek kayıttan), temiz git deposu; `fetch` tuzaklı, HOME geçici.
//   §1 anahtarsız üretim: çıkış 3 + son satır `SONUC: IMZA-BEKLIYOR` · ad · çıktıda yalnız zip + künye ·
//      zip düzeni BAĞIMSIZ araçla (unzip/zipinfo): bayt sıralı, manifesto kökte, `pgsql/` öneki ve dizin
//      girdisi yok, sabit damga + 0644 · açılan dizin manifestoyla birebir (kurulum-pg'nin ölçümü) ·
//      künye alanları · imza komutu mutlak yollarla, anahtar dosyası okunamazken (000) · önbellek, ağ yok
//   §2 belirlenimlilik: ikinci üretim aynı bayt · §3 `--dogrula` üretilen pakete 0
//   §4 EDB zip'i kayıtla uyuşmaz (SHA256 · boyut) → DUR 1, paket yok, önbellek dosyası yerinde ·
//      önbellekte yoksa kayıttaki resmî adrese gider (tuzak → DUR 2, paket yok)
//   §5 zip aracı sapar (fazla girdi · içerik değişir) → DUR 1, paket bırakılmaz
//   §6 düzen sapmaları `--dogrula`da: kök sarılı · manifesto yok · dizin girdisi · sembolik bağ ·
//      manifesto + dosya birlikte değişmiş (kayıttan sapar) → 1
//   §7 kirli deploy/pg → DUR 1 · dolu çıktı dizini → 2 · olmayan anahtar dosyası → 2, iş yapılmadan
// Kapsam dışı: `--anahtar` ile gerçek imza (TS aracı + parola; imzanın kendisi test_backend_yayin §3s'de).
//
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (zip/unzip/git yok). Cırcır değil (taban yok).
// Çalışıyor mu: §4–§7 kalıcı negatif sondalar her koşumda; betikteki kapılar tek tek kapatılınca kırmızı
//   verdiği ÖLÇÜLDÜ (Teks-Erp/docs/BEKCI-HARITASI.md satırı, ✓B). Gerekli mi: ÖLÇÜLMEDİ — üretim komutu bu
//   bekçiyle birlikte doğdu; D8'in elle ürettiği paket de aynı ölçümden geçti, yakalanmış gerçek kusur yok.
//   node scripts/test_pg_paketle.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFESTO_ADI = 'TEKSERP-ICERIK.sha256';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bayt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

let gecti = 0;
let kaldi = 0;
function check(ad, ok, detay = '') {
  if (ok) gecti += 1;
  else kaldi += 1;
  console.log(`${ok ? '✅' : '❌'} ${ad}${!ok && detay ? ` — ${String(detay).replace(/\s+/g, ' ').slice(0, 500)}` : ''}`);
}
function olculemedi(msg) {
  console.log(`⛔ ÖLÇÜLEMEDİ — ${msg}`);
  console.log('\n=== Sonuç: ÖLÇÜLEMEDİ ===');
  process.exit(2);
}

const GIT_ORTAM = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
function arac(komut, args, secenek = {}) {
  const r = spawnSync(komut, args, { encoding: 'utf8', env: GIT_ORTAM, maxBuffer: 64 * 1024 * 1024, ...secenek });
  if (r.error) olculemedi(`${komut} çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) olculemedi(`${komut} ${args.join(' ')} çıkış ${r.status}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}
for (const [k, a] of [['zip', ['-v']], ['unzip', ['-v']], ['git', ['--version']]]) arac(k, a);
const GERCEK_ZIP = arac('sh', ['-c', 'command -v zip']).trim();

const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-pg-paketle-')));
process.on('exit', () => fs.rmSync(TEMP, { recursive: true, force: true }));
const yol = (...p) => path.join(TEMP, ...p);
function yaz(dosya, veri) {
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, veri);
}
function dosyalar(kok, rel = '') {
  const c = [];
  for (const g of fs.readdirSync(path.join(kok, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${g.name}` : g.name;
    if (g.isDirectory()) c.push(...dosyalar(kok, r));
    else c.push(r);
  }
  return c;
}

/* ------------------------------------------------------------------ *
 * Gölge kök: deploy/pg kopyası + sahte EDB zip'i + ona göre kayıt
 * ------------------------------------------------------------------ */
const GERCEK = JSON.parse(fs.readFileSync(path.join(KOK, 'deploy/pg/pg-surumu.json'), 'utf8'));
const HEDEF = GERCEK.yayin['win-x64'];
const GOLGE = yol('kok');
fs.cpSync(path.join(KOK, 'deploy', 'pg'), path.join(GOLGE, 'deploy', 'pg'), { recursive: true });
const BETIK = path.join(GOLGE, 'deploy', 'pg', 'pg-paketle.mjs');

/** En küçük PE32+ başlığı: sertifika dizini boş (imzasız), istenen dizge gövdede. */
function pe(dizge) {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  b.writeUInt16LE(0x20b, 0x40 + 24);
  b.write(dizge, 300, 'latin1');
  return b;
}
const SAHNE = {
  [`bin/icuuc${HEDEF.icuSurum}.dll`]: Buffer.from('icu sahte\n'),
  'share/timezone/Europe/Istanbul': Buffer.from('TZif sahte\n'),
  'server_license.txt': Buffer.from('lisans\n'),
  'commandlinetools_3rd_party_licenses.txt': Buffer.from('ucuncu taraf\n'),
};
for (const rel of GERCEK.zorunlu.ikililer) SAHNE[rel] = pe(rel.endsWith('.exe') ? `${rel} (PostgreSQL) ${GERCEK.surum}\n` : rel);
for (const u of GERCEK.zorunlu.uzantilar) {
  SAHNE[`share/extension/${u}.control`] = Buffer.from(`# ${u}\n`);
  SAHNE[`lib/${u}.dll`] = pe(u);
}
// Sahneye GİRMEYENLER (kaydın haric/dahil kuralları): pakete sızarlarsa §1c kırmızı.
const DISARIDA = {
  'bin/stackbuilder.exe': pe('stackbuilder'),
  'bin/pg_regress.exe': pe('pg_regress'),
  'lib/libpq.lib': Buffer.from('lib\n'),
  'doc/postgresql/index.html': Buffer.from('<p>doc</p>\n'),
  'include/pg_config.h': Buffer.from('#define X 1\n'),
};
const EDB_KAYNAK = yol('edb');
for (const [rel, v] of Object.entries({ ...SAHNE, ...DISARIDA })) yaz(path.join(EDB_KAYNAK, HEDEF.arsivKok, ...rel.split('/')), v);
const ONBELLEK = yol('onbellek');
fs.mkdirSync(ONBELLEK);
const EDB = path.join(ONBELLEK, HEDEF.dosya);
arac('zip', ['-q', '-r', '-X', EDB, HEDEF.arsivKok], { cwd: EDB_KAYNAK });
const EDB_VERI = fs.readFileSync(EDB);
const EDB_SHA = sha(EDB_VERI);

const SAHNE_ADLARI = Object.keys(SAHNE).sort(bayt);
const MANIFESTO = Buffer.from(SAHNE_ADLARI.map((r) => `${sha(SAHNE[r])}  ${r}\n`).join(''));
const KAYIT = structuredClone(GERCEK);
Object.assign(KAYIT.yayin['win-x64'], { boyut: EDB_VERI.length, sha256: EDB_SHA });
Object.assign(KAYIT.sahne, { dosyaSayisi: SAHNE_ADLARI.length, boyut: SAHNE_ADLARI.reduce((t, r) => t + SAHNE[r].length, 0), icerikSha256: sha(MANIFESTO) });
fs.writeFileSync(path.join(GOLGE, 'deploy/pg/pg-surumu.json'), `${JSON.stringify(KAYIT, null, 2)}\n`);

const git = (...a) => arac('git', ['-C', GOLGE, '-c', 'user.name=bekci', '-c', 'user.email=bekci@yerel', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a]).trim();
git('init', '-q');
git('add', '-A');
git('commit', '-q', '-m', 'golge');
const HEAD = git('rev-parse', 'HEAD');

// Ağ tuzağı: betik ve alt süreci (pg-ikili-dogrula) fetch çağırırsa iz bırakır ve düşer.
const AG_IZI = yol('ag-izi.txt');
const TUZAK = yol('ag-tuzagi.mjs');
fs.writeFileSync(TUZAK, "import fs from 'node:fs';\nglobalThis.fetch = async (u) => { fs.appendFileSync(process.env.BEKCI_AG_IZI, `${u}\\n`); throw new Error('AG YASAK (bekci)'); };\n");
const agIzi = () => (fs.existsSync(AG_IZI) ? fs.readFileSync(AG_IZI, 'utf8') : '');

// Geçici HOME: üretim anahtarı YERİNDE ama okunamaz (000) — betik yalnız yolunu basmalı.
const EV = yol('ev');
const ANAHTAR = path.join(EV, '.tekserp', 'satici-uretim', 'paket', 'paket-sahte.paket.json');
yaz(ANAHTAR, 'SIR-OKUNMAMALI\n');
fs.chmodSync(ANAHTAR, 0o000);
fs.mkdirSync(yol('tmp'));

function kos(args, { yolOnEki } = {}) {
  const env = { ...GIT_ORTAM, HOME: EV, TMPDIR: yol('tmp'), NODE_OPTIONS: `--import=${pathToFileURL(TUZAK).href}`, BEKCI_AG_IZI: AG_IZI, BEKCI_GERCEK_ZIP: GERCEK_ZIP };
  if (yolOnEki) env.PATH = `${yolOnEki}${path.delimiter}${process.env.PATH}`;
  const r = spawnSync(process.execPath, [BETIK, ...args], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return { kod: r.status, out: r.stdout ?? '', hepsi: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const bosMu = (d) => !fs.existsSync(d) || fs.readdirSync(d).length === 0;
const PAKET_ADI = `postgresql-${GERCEK.surum}-${GERCEK.derleme}-tekserp.zip`;

console.log(`test_pg_paketle — PG paketi üretimi (gölge kök, sahte EDB ${SAHNE_ADLARI.length}+${Object.keys(DISARIDA).length} dosya)\n`);

/* §1 anahtarsız üretim */
const C1 = yol('cikti1');
const r1 = kos(['--cikti', C1, '--onbellek', ONBELLEK]);
const Z1 = path.join(C1, PAKET_ADI);
const sonSatir = r1.out.trim().split('\n').pop();
check('§1a anahtarsız: çıkış 3 (İMZA BEKLİYOR) + son satır `SONUC: IMZA-BEKLIYOR`', r1.kod === 3 && sonSatir === 'SONUC: IMZA-BEKLIYOR', `çıkış ${r1.kod} · ${r1.hepsi.slice(-600)}`);
const ciktiDosyalari = fs.existsSync(C1) ? fs.readdirSync(C1).sort(bayt) : [];
check(`§1b çıktıda yalnız ${PAKET_ADI} + pg-paketi.json (pg.json yok, iş dizini kalmadı)`, JSON.stringify(ciktiDosyalari) === JSON.stringify([PAKET_ADI, 'pg-paketi.json'].sort(bayt)), ciktiDosyalari.join(', '));
if (!fs.existsSync(Z1)) {
  console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi + 1} başarısız (paket üretilmedi; kalan bölümler koşmadı) ===`);
  process.exit(1);
}
const Z1_VERI = fs.readFileSync(Z1);
const girdiler = arac('unzip', ['-Z1', Z1]).split('\n').filter(Boolean);
const beklenenGirdiler = [...SAHNE_ADLARI, MANIFESTO_ADI].sort(bayt);
check('§1c zip girdileri (unzip -Z1) = sahne + manifesto, bayt sıralı; kök öneki / dizin / sahne dışı dosya yok', JSON.stringify(girdiler) === JSON.stringify(beklenenGirdiler), girdiler.join(' '));
check('§1d kökteki manifesto (unzip -p) = sahnenin beklenen manifestosu', arac('unzip', ['-p', Z1, MANIFESTO_ADI], { encoding: 'buffer' }).equals(MANIFESTO));
const bilgi = arac('unzip', ['-Z', '-T', Z1], { env: { ...GIT_ORTAM, TZ: 'UTC' } }).split('\n').filter((l) => /^[-dl]/.test(l));
const damga = `${GERCEK.yayinTarihi.replace(/-/g, '')}.000000`;
const sapanBilgi = bilgi.filter((l) => {
  const s = l.trim().split(/\s+/);
  return s[0] !== '-rw-r--r--' || s[6] !== damga;
});
check(`§1e her girdi 0644 ve damga ${damga} (kaydın yayinTarihi, UTC)`, bilgi.length === beklenenGirdiler.length && sapanBilgi.length === 0, sapanBilgi.slice(0, 3).join(' | ') || `${bilgi.length} satır`);
const ACILAN = yol('acilan1');
arac('unzip', ['-q', Z1, '-d', ACILAN]);
const acilan = dosyalar(ACILAN).sort(bayt);
const satirlar = MANIFESTO.toString().trim().split('\n').map((s) => [s.slice(66), s.slice(0, 64)]);
const ozetHatasi = satirlar.filter(([rel, h]) => !fs.existsSync(path.join(ACILAN, rel)) || sha(fs.readFileSync(path.join(ACILAN, rel))) !== h);
check('§1f açılan dizin (kurulum-pg gibi olduğu gibi): manifestodaki her dosya özetiyle yerinde, fazla dosya yok', JSON.stringify(acilan) === JSON.stringify(beklenenGirdiler) && ozetHatasi.length === 0, `${acilan.length} dosya · özet hatası ${ozetHatasi.map(([r]) => r).join(', ')}`);
let kunye = {};
try {
  kunye = JSON.parse(fs.readFileSync(path.join(C1, 'pg-paketi.json'), 'utf8'));
} catch {
  /* aşağıdaki kontrol düşer */
}
const kunyeFarki = [
  ['paket.ad', kunye.paket?.ad, PAKET_ADI],
  ['paket.boyut', kunye.paket?.boyut, Z1_VERI.length],
  ['paket.sha256', kunye.paket?.sha256, sha(Z1_VERI)],
  ['icerikSha256', kunye.icerikSha256, sha(MANIFESTO)],
  ['edb.sha256', kunye.edb?.sha256, EDB_SHA],
  ['surum', kunye.surum, GERCEK.surum],
  ['derleme', kunye.derleme, GERCEK.derleme],
  ['icuSurum', kunye.icuSurum, HEDEF.icuSurum],
  ['uretim.betikCommit', kunye.uretim?.betikCommit, HEAD],
].filter(([, a, b]) => a !== b);
check('§1g künye (pg-paketi.json): paket ad/boyut/sha256 · içerik özeti · EDB sha · sürüm · ICU · betik commit\'i', kunyeFarki.length === 0, kunyeFarki.map(([k, a, b]) => `${k} ${a}≠${b}`).join(' · '));
const imzaSatiri = `cd ${path.join(GOLGE, 'Teks-Erp')} && npx tsx scripts/backend-bildirim.ts pg-imzala --zip=${Z1} --anahtar=${ANAHTAR} --cikti=${C1}`;
const anahtarDurumu = fs.statSync(ANAHTAR);
check('§1h imza adımında durdu: pg-imzala komutu mutlak yollarla ve üretim anahtarının YOLUYLA (dosya 000 — okunsaydı düşerdi)', r1.out.split('\n').some((l) => l.trim() === imzaSatiri) && (anahtarDurumu.mode & 0o777) === 0, `beklenen: ${imzaSatiri}`);
check('§1i EDB zip\'i önbellekten, ağa çıkılmadı', /önbellekten/.test(r1.out) && agIzi() === '', agIzi());

/* §2 belirlenimlilik · §3 --dogrula */
const C2 = yol('cikti2');
const r2 = kos(['--cikti', C2, '--onbellek', ONBELLEK]);
const z2 = path.join(C2, PAKET_ADI);
check('§2 ikinci üretim aynı bayt (sıralı girdi + sabit damga + ek alan yok)', r2.kod === 3 && fs.existsSync(z2) && sha(fs.readFileSync(z2)) === sha(Z1_VERI), `çıkış ${r2.kod}`);
const r3 = kos(['--dogrula', Z1]);
check('§3 --dogrula üretilen pakete 0 (kayıtla eşit)', r3.kod === 0 && /kayıtla eşit/.test(r3.out), r3.hepsi.slice(-300));

/* §4 EDB zip'i kayıtla uyuşmaz */
function bozukOnbellek(ad, degistir) {
  const d = yol(ad);
  fs.mkdirSync(d);
  const v = Buffer.from(EDB_VERI);
  fs.writeFileSync(path.join(d, HEDEF.dosya), degistir(v));
  return { d, oncesi: sha(fs.readFileSync(path.join(d, HEDEF.dosya))) };
}
{
  const b = bozukOnbellek('onbellek-sha', (v) => {
    v[Math.floor(v.length / 2)] ^= 0xff;
    return v;
  });
  const c = yol('cikti-sha');
  const r = kos(['--cikti', c, '--onbellek', b.d]);
  const yerinde = fs.existsSync(path.join(b.d, HEDEF.dosya)) && sha(fs.readFileSync(path.join(b.d, HEDEF.dosya))) === b.oncesi;
  check('§4a EDB SHA256 kayıtla uyuşmaz (boyut aynı) → DUR 1, paket/künye yok, önbellek dosyası silinmedi, ağ yok', r.kod === 1 && /SHA256 UYUŞMUYOR/.test(r.hepsi) && bosMu(c) && yerinde && agIzi() === '', `çıkış ${r.kod} · ${r.hepsi.slice(-400)}`);
}
{
  const b = bozukOnbellek('onbellek-boyut', (v) => Buffer.concat([v, Buffer.from([0])]));
  const c = yol('cikti-boyut');
  const r = kos(['--cikti', c, '--onbellek', b.d]);
  check('§4b EDB boyutu kayıtla uyuşmaz → DUR 1, paket yok', r.kod === 1 && /BOYUT UYUŞMUYOR/.test(r.hepsi) && bosMu(c), `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
}
{
  const c = yol('cikti-indir');
  const r = kos(['--cikti', c, '--onbellek', yol('onbellek-bos')]);
  check('§4c önbellekte yoksa kayıttaki resmî adrese gider (tuzak düşürür → DUR 2, paket yok)', r.kod === 2 && agIzi().trim() === HEDEF.url && bosMu(c), `çıkış ${r.kod} · iz ${agIzi().trim()}`);
  fs.rmSync(AG_IZI, { force: true });
}

/* §5 zip aracı sapar → betiğin kendi ölçümü durdurur */
function sahteZip(ad, eylem) {
  const d = yol(ad);
  yaz(path.join(d, 'zip'), `#!/bin/sh\n"$BEKCI_GERCEK_ZIP" "$@" || exit $?\nZ=\nfor a in "$@"; do case "$a" in *.zip) Z="$a";; esac; done\n[ -n "$Z" ] || exit 0\n${eylem}\n`);
  fs.chmodSync(path.join(d, 'zip'), 0o755);
  return d;
}
{
  const c = yol('cikti-fazla');
  const r = kos(['--cikti', c, '--onbellek', ONBELLEK], { yolOnEki: sahteZip('zip-fazla', `printf 'fazla' > bin/fazla.dll && "$BEKCI_GERCEK_ZIP" -q -X "$Z" bin/fazla.dll`) });
  check('§5a zip manifestoda olmayan girdi taşır → DUR 1, paket bırakılmaz', r.kod === 1 && /manifestoda olmayan girdi: bin\/fazla\.dll/.test(r.hepsi) && bosMu(c), `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
}
{
  const c = yol('cikti-icerik');
  const r = kos(['--cikti', c, '--onbellek', ONBELLEK], { yolOnEki: sahteZip('zip-icerik', `printf 'kurcalandi' > bin/postgres.exe && "$BEKCI_GERCEK_ZIP" -q -X "$Z" bin/postgres.exe`) });
  check('§5b zip\'teki dosya manifestodaki özetten sapar → DUR 1, paket bırakılmaz', r.kod === 1 && /bin\/postgres\.exe: özet manifestoyla aynı değil/.test(r.hepsi) && bosMu(c), `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
}

/* §6 düzen sapmaları — --dogrula */
function kopya(ad) {
  const z = yol(`${ad}.zip`);
  fs.copyFileSync(Z1, z);
  return z;
}
function dogrulaSapma(etiket, z, desen) {
  const r = kos(['--dogrula', z]);
  check(etiket, r.kod === 1 && desen.test(r.hepsi), `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
}
{
  const d = yol('d1');
  fs.mkdirSync(path.join(d, HEDEF.arsivKok), { recursive: true });
  arac('unzip', ['-q', Z1, '-d', path.join(d, HEDEF.arsivKok)]);
  const z = yol('d1.zip');
  arac('zip', ['-q', '-r', '-X', '-D', z, HEDEF.arsivKok], { cwd: d });
  dogrulaSapma(`§6a kök sarılı (${HEDEF.arsivKok}/…) → 1 (manifesto kökte değil)`, z, /kökte değil/);
}
{
  const z = kopya('d2');
  arac('zip', ['-q', '-d', z, MANIFESTO_ADI]);
  dogrulaSapma('§6b manifesto yok → 1', z, /TEKSERP-ICERIK\.sha256 yok/);
}
{
  const z = kopya('d3');
  fs.mkdirSync(yol('d3k', 'bin'), { recursive: true });
  arac('zip', ['-q', z, 'bin'], { cwd: yol('d3k') });
  dogrulaSapma('§6c dizin girdisi → 1', z, /dizin girdisi: bin\//);
}
{
  const z = kopya('d4');
  fs.mkdirSync(yol('d4k'));
  fs.symlinkSync('bin/postgres.exe', yol('d4k', 'baglanti'));
  arac('zip', ['-q', '-y', z, 'baglanti'], { cwd: yol('d4k') });
  dogrulaSapma('§6d sembolik bağ girdisi → 1', z, /sembolik bağ girdisi: baglanti/);
}
{
  const d = yol('d5');
  arac('unzip', ['-q', Z1, '-d', d]);
  fs.appendFileSync(path.join(d, 'server_license.txt'), 'ek satir\n');
  const yeni = Buffer.from(SAHNE_ADLARI.map((r) => `${sha(fs.readFileSync(path.join(d, r)))}  ${r}\n`).join(''));
  fs.writeFileSync(path.join(d, MANIFESTO_ADI), yeni);
  const z = yol('d5.zip');
  arac('zip', ['-q', '-X', '-D', z, '-@'], { cwd: d, input: `${beklenenGirdiler.join('\n')}\n` });
  dogrulaSapma('§6e dosya + manifesto birlikte değişmiş (kendi içinde tutarlı) → 1 (manifesto kayıttan sapar)', z, /manifesto [0-9a-f]{16}… — kayıt/);
}

/* §7 ön koşullar */
{
  const sablon = path.join(GOLGE, 'deploy/pg/pg-sablon.mjs');
  fs.appendFileSync(sablon, '\n// kirli\n');
  const c = yol('cikti-kirli');
  const r = kos(['--cikti', c, '--onbellek', ONBELLEK]);
  check('§7a deploy/pg kirli → DUR 1, çıktı dizini açılmadı', r.kod === 1 && /KİRLİ/.test(r.hepsi) && !fs.existsSync(c), `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
  git('checkout', '--', 'deploy/pg/pg-sablon.mjs');
  if (git('status', '--porcelain') !== '') olculemedi('gölge kök geri alınamadı');
}
{
  const c = yol('cikti-dolu');
  yaz(path.join(c, 'eski.txt'), 'eski\n');
  const r = kos(['--cikti', c, '--onbellek', ONBELLEK]);
  check('§7b çıktı dizini boş değil → 2, var olan dosyaya dokunulmadı', r.kod === 2 && /boş değil/.test(r.hepsi) && JSON.stringify(fs.readdirSync(c)) === '["eski.txt"]', `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
}
{
  const c = yol('cikti-anahtarsiz');
  const r = kos(['--cikti', c, '--onbellek', ONBELLEK, '--anahtar', yol('yok.paket.json')]);
  check('§7c --anahtar dosyası yok → 2, iş yapılmadan (çıktı dizini açılmadı)', r.kod === 2 && /anahtar dosyası yok/.test(r.hepsi) && !fs.existsSync(c), `çıkış ${r.kod} · ${r.hepsi.slice(-300)}`);
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
