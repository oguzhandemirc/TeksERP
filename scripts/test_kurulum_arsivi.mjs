#!/usr/bin/env node
// =============================================================================
// BEKÇİ — KURULUM ARŞİVİ (deploy/kurulum/kurulum-arsivi.mjs) · zero-dep, DB'siz, AĞSIZ
// =============================================================================
// Müşteriye portalda TEK bağlantıyla giden arşiv bu betikten doğar. Betik GÖLGE bir kökte GERÇEK süreç olarak koşar:
// deploy/kurulum + deploy/pg + scripts/lib + dagitim.json (+ kanal-adlari.ps1, vendor-url.ts) + satıcının storage.ts
// kopyası — eski kanal kaydı (kanallar.json) gölgede YOKTUR (ortak arşiv onu okumaz, O11a); PG kaydı sahte PG zip'ine
// göre yazılır (yapısı gerçek kayıttan); imza doğrulayıcısı (`Teks-Erp/scripts/backend-bildirim.ts`) gölgede KAYIT
// TUTAN bir koçandır (çağrı argümanları + ortamdaki test çapası deftere düşer, senaryoya göre geçerli/geçersiz döner) —
// gerçek imza kriptografisi test_backend_yayin'in alanıdır, burada betiğin onu DOĞRU çağırıp sonucuna UYDUĞU ölçülür.
//   §1 mutlu yol: 0 · arşiv + .sha256 · bağımsız araçla (zipinfo/unzip/shasum) DÜZ kök, 7 girdi, zip/exe "stor",
//      SHA256SUMS tutar · BENIOKU BOM+CRLF+setup adı · doğrulayıcı TEK kez `ortak-dogrula` + ÜRETİM çapası (--guven-capasi,
//      --pg-kunye; kanal/grup argümanı YOK) · ortamdaki TEKSERP_TEST_PAKET_CAPASI doğrulayıcıya GEÇMEZ · sahne/yarım kalmaz
//   §2 aynı girdi → aynı bayt · §3 var olan arşiv ezilmez (2)
//   §4 kapılar (her biri DUR, arşiv bırakılmaz): ortak paket değil (kanallı / boş dize) · filigranda müşteri/kurulum ·
//      hizmet adı dağıtım kaydından farklı · --musteri kalktı (2) · pg.json özeti · imzasız · imza geçersiz · imzalı künye başka PG ·
//      çapa kipi · korumasız · PROVA paketi · hizmet ikilisi · boru-sınaması setup · PE değil · pg.json adı · tkpub (özel
//      anahtar · sağlama) · PG zip kayıttan sapar · girdi iki kez / yok / aynı dosya iki girdi · çıktı depo içinde
//   §5 --prova: imzasız backend → 0, ad `-PROVA-IMZASIZ`, uyarı; pg.json yalnız `pg-dogrula`yla; geçersiz imza uyarı kalır
//   §6 setup desenleri kurulum.ps1/on-olcum.ps1/iss METNİNDEN; yeri değişirse ÖLÇÜLEMEDİ · üretilen arşivde her desen TAM bir dosya
//   §7 doğrulayıcı koşamazsa (tsx yok) ÖLÇÜLEMEDİ 2
// ÜÇ SONUÇ: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ (zip/unzip yok). Cırcır değil.
// Çalışıyor mu: §3–§7 kalıcı negatif senaryolar her koşumda; betikteki kapılar tek tek kapatılınca kırmızı verdiği
//   ÖLÇÜLDÜ (Teks-Erp/docs/BEKCI-HARITASI.md satırı, ✓B). Gerekli mi: ÖLÇÜLMEDİ — betik bu bekçiyle birlikte doğdu
//   (ilk prova eski 2.13.0 zip'inin dört kapının üçünü geçtiğini, hizmet düzeni kapısında durduğunu gösterdi).
//   node scripts/test_kurulum_arsivi.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bayt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

let gecti = 0;
let kaldi = 0;
function check(ad, ok, detay = '') {
  if (ok) gecti += 1;
  else kaldi += 1;
  console.log(`${ok ? '✅' : '❌'} ${ad}${!ok && detay ? ` — ${String(detay).replace(/\s+/g, ' ').slice(0, 400)}` : ''}`);
}
function olculemedi(msg) {
  console.log(`⛔ ÖLÇÜLEMEDİ — ${msg}\n\n=== Sonuç: ÖLÇÜLEMEDİ ===`);
  process.exit(2);
}
function arac(komut, args, secenek = {}) {
  const r = spawnSync(komut, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...secenek });
  if (r.error) olculemedi(`${komut} çalıştırılamadı: ${r.error.message}`);
  return r;
}
for (const [k, a] of [['zip', ['-v']], ['unzip', ['-v']], ['zipinfo', ['-h']]]) arac(k, a);

const TEMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'test-kurulum-arsivi-')));
process.on('exit', () => fs.rmSync(TEMP, { recursive: true, force: true }));
const yol = (...p) => path.join(TEMP, ...p);
function yaz(dosya, veri) {
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, veri);
}
function zipYap(hedef, dosyalar) {
  const d = fs.mkdtempSync(path.join(TEMP, 'z-'));
  for (const [rel, v] of Object.entries(dosyalar)) yaz(path.join(d, ...rel.split('/')), v);
  fs.rmSync(hedef, { force: true });
  fs.mkdirSync(path.dirname(hedef), { recursive: true });
  const r = arac('zip', ['-q', '-X', '-D', hedef, '-@'], { cwd: d, input: `${Object.keys(dosyalar).sort(bayt).join('\n')}\n` });
  if (r.status !== 0) olculemedi(`zip ${r.stderr}`);
  fs.rmSync(d, { recursive: true, force: true });
  return hedef;
}

// ---------------------------------------------------------------- gölge kök
const G = yol('kok');
for (const rel of ['deploy/kurulum', 'deploy/pg', 'scripts/lib']) fs.cpSync(path.join(KOK, rel), path.join(G, rel), { recursive: true });
for (const rel of ['deploy/dagitim.json', 'deploy/hizmet/kanal-adlari.ps1', 'Teks-Erp/src/lib/license/vendor-url.ts', 'satici/sunucu/src/distribution/storage.ts']) yaz(path.join(G, rel), fs.readFileSync(path.join(KOK, rel)));
const BETIK = path.join(G, 'deploy/kurulum/kurulum-arsivi.mjs');
// tsx koçanı: .ts'yi düz ES modülü olarak yükler (koçan tipsiz JS'tir); gerçek tsx gölgeye girmez.
yaz(path.join(G, 'Teks-Erp/node_modules/tsx/package.json'), '{"name":"tsx","version":"0.0.0-bekci","type":"module","exports":{".":"./index.mjs"}}\n');
yaz(path.join(G, 'Teks-Erp/node_modules/tsx/index.mjs'), "import { register } from 'node:module';\nregister('./kanca.mjs', import.meta.url);\n");
yaz(path.join(G, 'Teks-Erp/node_modules/tsx/kanca.mjs'), "export async function load(url, context, next) {\n  if (url.endsWith('.ts')) {\n    const r = await next(url, { ...context, format: 'module' });\n    return { ...r, format: 'module', shortCircuit: true };\n  }\n  return next(url, context);\n}\n");
yaz(path.join(G, 'Teks-Erp/scripts/backend-bildirim.ts'), `import fs from 'node:fs';
const argv = process.argv.slice(2);
const komut = argv[0];
const f = Object.fromEntries(argv.slice(1).map((a) => { const i = a.indexOf('='); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), '']; }));
fs.appendFileSync(process.env.BEKCI_TS_IZ, JSON.stringify({ komut, f, testCapasi: process.env.TEKSERP_TEST_PAKET_CAPASI ?? null }) + '\\n');
const senaryo = process.env.BEKCI_TS_SENARYO || 'gecerli';
if (senaryo === 'gecersiz') { console.error('✖ paket bütünlüğü GECERSIZ (IMZA) — imzasız/kurcalı paket yayınlanmaz'); process.exit(2); }
const pg = JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(f['pg-kunye'] ?? f.kunye, 'utf8')).bildirim.split('.')[1], 'base64url').toString());
const paket = senaryo === 'baska-pg' ? { ...pg.paket, sha256: '0'.repeat(64) } : pg.paket;
fs.writeFileSync(f.cikti + '/sonuc.json', JSON.stringify(komut === 'ortak-dogrula'
  ? { v: 1, kip: komut, surum: process.env.BEKCI_TS_SURUM, paketImzaKid: 'paket-sahte', pg: { hedef: { paket } }, uyarilar: [] }
  : { v: 1, kip: komut, kunye: pg }));
console.error('✓ ' + komut + ' (koçan)');
`);

// Sahte PG paketi + ona göre kayıt.
const GERCEK = JSON.parse(fs.readFileSync(path.join(KOK, 'deploy/pg/pg-surumu.json'), 'utf8'));
const ICU = GERCEK.yayin['win-x64'].icuSurum;
function pe(dizge) {
  const b = Buffer.alloc(512);
  b.write('MZ', 0, 'latin1');
  b.writeUInt32LE(0x40, 0x3c);
  b.write('PE\0\0', 0x40, 'latin1');
  b.writeUInt16LE(0x20b, 0x40 + 24);
  b.write(dizge, 300, 'latin1');
  return b;
}
const SAHNE = { [`bin/icuuc${ICU}.dll`]: Buffer.from('icu\n'), 'server_license.txt': Buffer.from('lisans\n') };
for (const rel of GERCEK.zorunlu.ikililer) SAHNE[rel] = pe(rel);
const ADLAR = Object.keys(SAHNE).sort(bayt);
const MANIFESTO = Buffer.from(ADLAR.map((r) => `${sha(SAHNE[r])}  ${r}\n`).join(''));
const KAYIT = structuredClone(GERCEK);
Object.assign(KAYIT.sahne, { dosyaSayisi: ADLAR.length, boyut: ADLAR.reduce((t, r) => t + SAHNE[r].length, 0), icerikSha256: sha(MANIFESTO) });
yaz(path.join(G, 'deploy/pg/pg-surumu.json'), `${JSON.stringify(KAYIT, null, 2)}\n`);
const PG_AD = `postgresql-${GERCEK.surum}-${GERCEK.derleme}-tekserp.zip`;

// ---------------------------------------------------------------- girdiler
const DAGITIM = JSON.parse(fs.readFileSync(path.join(KOK, 'deploy/dagitim.json'), 'utf8'));
const HIZMET_ADI = DAGITIM.urun.backend.hizmetAdi;
const SURUM = '9.9.9';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function pgKunye(paket, ek = {}) {
  const y = { v: 1, urun: 'postgresql', platform: 'win32-x64', cizgi: Number(GERCEK.cizgi), surum: GERCEK.surum, derleme: Number(GERCEK.derleme), paket, icerikSha256: sha(MANIFESTO), icuSurum: ICU, yayinZamani: '2026-10-02T00:00:00.000Z', ...ek };
  return `${JSON.stringify({ v: 1, bildirim: `${b64({ alg: 'EdDSA', kid: 'paket-sahte' })}.${b64(y)}.c2FodGU` })}\n`;
}
function tkpub() {
  const raw = crypto.randomBytes(32);
  return `# TeksERP yedek alicisi - ad: etkili\ntkpub1:${Buffer.concat([raw, Buffer.from(sha(raw), 'hex').subarray(0, 4)]).toString('base64url')}\n`;
}
const HIZMET = pe('tekserp-hizmet');
const GUNC = pe('tekserp-guncelleyici');
function backendZip(hedef, { paket = {}, kunye = {}, imzali = true, ek = {}, cikar = [] } = {}) {
  const p = { ad: 'tekserp-backend', commit: 'a'.repeat(40), backendKanal: null, backendHizmetAdi: HIZMET_ADI, korumali: true, korumaHedef: 'win-x64', prova: false,
    uygulamaSurumu: SURUM, butunlukKid: imzali ? 'paket-sahte' : null, hizmetIkilileri: { 'tekserp-hizmet.exe': { boyut: HIZMET.length }, 'tekserp-guncelleyici.exe': { boyut: GUNC.length } }, ...paket };
  const d = {
    'PAKET.json': `﻿${JSON.stringify(p, null, 2)}\n`,
    'dist/server-kunye.json': JSON.stringify({ urun: 'backend', musteri: null, kurulumId: null, guvenCapasi: 'uretim', zaman: '2026-10-01T10:00:00.000Z', ...kunye }),
    'dist/server.jsc': 'jsc',
    'runtime/node.exe': pe('node'),
    'runtime/tekserp-hizmet.exe': HIZMET,
    'runtime/tekserp-guncelleyici.exe': GUNC,
    ...(imzali ? { 'butunluk.jws': 'a.b.c', 'butunluk-liste.txt': 'liste\n' } : {}),
    ...ek,
  };
  for (const c of cikar) delete d[c];
  return zipYap(hedef, d);
}

const GIRDI = yol('girdi');
fs.mkdirSync(GIRDI);
const SETUP = path.join(GIRDI, 'TeksERP-Kurulum-9.9.9.exe');
fs.writeFileSync(SETUP, pe('setup'));
const BACKEND = backendZip(path.join(GIRDI, 'tekserp-backend-20261002_000000-aaaaaaa.zip'));
const PG = zipYap(path.join(GIRDI, PG_AD), { 'TEKSERP-ICERIK.sha256': MANIFESTO, ...SAHNE });
const PG_VERI = fs.readFileSync(PG);
const PGJSON = path.join(GIRDI, 'pg.json');
fs.writeFileSync(PGJSON, pgKunye({ ad: PG_AD, boyut: PG_VERI.length, sha256: sha(PG_VERI) }));
const TKPUB = path.join(GIRDI, 'etkili.tkpub');
fs.writeFileSync(TKPUB, tkpub());

const IZ = yol('ts-iz.jsonl');
function kos(ozel = {}, { senaryo = 'gecerli', cikti = yol('cikti', String(Math.random()).slice(2)), prova = false, tsxYok = false, args = null } = {}) {
  const g = { '--setup': SETUP, '--backend': BACKEND, '--pg': PG, '--pg-kunye': PGJSON, '--tkpub': TKPUB, '--cikti': cikti, ...ozel };
  const argv = args ?? [...Object.entries(g).filter(([, v]) => v !== null).flatMap(([k, v]) => [k, v]), ...(prova ? ['--prova'] : [])];
  fs.rmSync(IZ, { force: true });
  const tsx = path.join(G, 'Teks-Erp/node_modules/tsx');
  if (tsxYok) fs.renameSync(tsx, `${tsx}.yok`);
  try {
    const r = spawnSync(process.execPath, [BETIK, ...argv], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, BEKCI_TS_IZ: IZ, BEKCI_TS_SENARYO: senaryo, BEKCI_TS_SURUM: SURUM, TEKSERP_TEST_PAKET_CAPASI: yol('sahte-capa.json') } });
    const iz = fs.existsSync(IZ) ? fs.readFileSync(IZ, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const dosyalar = fs.existsSync(cikti) ? fs.readdirSync(cikti) : [];
    return { kod: r.status, cikti: `${r.stdout ?? ''}${r.stderr ?? ''}`, iz, dizin: cikti, dosyalar };
  } finally {
    if (tsxYok) fs.renameSync(`${tsx}.yok`, tsx);
  }
}
const ARSIV = `TeksERP-Kurulum-${SURUM}.zip`;

console.log(`test_kurulum_arsivi — kurulum arşivi (gölge kök, sahte PG ${ADLAR.length} dosya, doğrulayıcı koçanı)\n`);

// §1 mutlu yol
let ILK_SHA = null;
{
  const r = kos();
  const a = path.join(r.dizin, ARSIV);
  check('§1a çıkış 0 · SONUC: ARSIV-HAZIR · çıktıda yalnız arşiv + .sha256 (sahne/yarım yok) · gölgede kanallar.json YOK', !fs.existsSync(path.join(G, 'deploy/kanallar.json')) && r.kod === 0 && /SONUC: ARSIV-HAZIR/.test(r.cikti) && JSON.stringify(r.dosyalar.sort()) === JSON.stringify([ARSIV, `${ARSIV}.sha256`]), `kod ${r.kod} · ${r.dosyalar.join(',')} · ${r.cikti.slice(-300)}`);
  if (fs.existsSync(a)) {
    ILK_SHA = sha(fs.readFileSync(a));
    const zi = arac('zipinfo', [a]).stdout.split('\n').filter((l) => /^[-d]r/.test(l));
    const ad = (l) => l.trim().split(/\s+/).slice(8).join(' ');
    const beklenen = ['BENIOKU.txt', 'SHA256SUMS', 'TeksERP-Kurulum-9.9.9.exe', 'etkili.tkpub', 'pg.json', PG_AD, path.basename(BACKEND)].sort(bayt);
    check('§1b bağımsız araç (zipinfo): DÜZ kök, tam 7 girdi, dizin girdisi yok', JSON.stringify(zi.map(ad).sort(bayt)) === JSON.stringify(beklenen) && zi.every((l) => !ad(l).includes('/')), zi.map(ad).join(','));
    const stor = zi.filter((l) => /\.(zip|exe)$/.test(ad(l)));
    check('§1c zip/exe girdileri "stor" (yeniden sıkıştırılmaz)', stor.length === 3 && stor.every((l) => /\sstor\s/.test(l)), stor.join(' | '));
    const ac = yol('ac', String(Math.random()).slice(2));
    fs.mkdirSync(ac, { recursive: true });
    arac('unzip', ['-q', a, '-d', ac]);
    const sums = fs.readFileSync(path.join(ac, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
    const tutan = sums.every((s) => {
      const [h, n] = s.split('  ');
      return fs.existsSync(path.join(ac, n)) && sha(fs.readFileSync(path.join(ac, n))) === h;
    });
    const kaynakEsit = [SETUP, BACKEND, PG, PGJSON, TKPUB].every((y) => sha(fs.readFileSync(y)) === sha(fs.readFileSync(path.join(ac, path.basename(y)))));
    check('§1d SHA256SUMS (sha256sum biçimi, bayt sıralı) her dosyayı tutar · girdiler kaynakla birebir', sums.length === 6 && tutan && kaynakEsit && JSON.stringify(sums.map((s) => s.split('  ')[1])) === JSON.stringify([...sums.map((s) => s.split('  ')[1])].sort(bayt)), `${sums.length} satır · tutan ${tutan} · kaynak ${kaynakEsit}`);
    const yan = fs.readFileSync(`${a}.sha256`, 'utf8');
    check('§1e yan dosya `<sha256>  <arşiv>` arşivi tutar', yan === `${ILK_SHA}  ${ARSIV}\n`, yan);
    const ben = fs.readFileSync(path.join(ac, 'BENIOKU.txt'));
    check('§1f BENIOKU: UTF-8 BOM + CRLF + "Tümünü ayıkla" + setup adı', ben.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && ben.includes('\r\n') && ben.toString('utf8').includes('Tümünü ayıkla') && ben.toString('utf8').includes('TeksERP-Kurulum-9.9.9.exe'), ben.toString('utf8').slice(0, 120));
  }
  const d = r.iz.filter((x) => x.komut === 'ortak-dogrula');
  const f = d[0]?.f ?? {};
  check('§1g doğrulayıcı TEK kez `ortak-dogrula`: --guven-capasi=uretim · --pg-kunye · --zip · kanal/grup argümanı YOK',
    r.iz.length === 1 && d.length === 1 && f['guven-capasi'] === 'uretim' && !('kanal' in f) && !('kanal-turu' in f) && !('grup' in f) && f['pg-kunye'] === PGJSON && f.zip === BACKEND && f['pg-cizgi'] === String(GERCEK.cizgi) && f['pg-en-az'] === GERCEK.backendEnAz,
    JSON.stringify(r.iz).slice(0, 300));
  check('§1h ortamdaki TEKSERP_TEST_PAKET_CAPASI doğrulayıcıya GEÇMEZ (yalnız gerçek üretim çapası)', r.iz.length === 1 && r.iz[0].testCapasi === null, JSON.stringify(r.iz[0]?.testCapasi));
}

// §2 belirlenimlilik · §3 ezmez
{
  const r = kos();
  const s = fs.existsSync(path.join(r.dizin, ARSIV)) ? sha(fs.readFileSync(path.join(r.dizin, ARSIV))) : null;
  check('§2 aynı girdiler → aynı bayt (sabit damga, sıralı girdi)', r.kod === 0 && s !== null && s === ILK_SHA, `${s} ≠ ${ILK_SHA}`);
  const once = sha(fs.readFileSync(path.join(r.dizin, ARSIV)));
  const t = kos({}, { cikti: r.dizin });
  check('§3 var olan arşiv EZİLMEZ → 2, dosya aynı', t.kod === 2 && sha(fs.readFileSync(path.join(r.dizin, ARSIV))) === once && /ezilmez/.test(t.cikti), `kod ${t.kod}`);
}

// §4 kapılar — her biri DUR, arşiv yok
function dur(ad, r, desen, { tsBos = true, kod = 1 } = {}) {
  const arsivYok = !r.dosyalar.some((x) => x.endsWith('.zip') || x.endsWith('.sha256') || x.startsWith('.'));
  check(`${ad} → ${kod === 1 ? 'DUR 1' : 'ÖLÇÜLEMEDİ 2'}, arşiv bırakılmaz${tsBos ? ', doğrulayıcıdan önce' : ''}`, r.kod === kod && desen.test(r.cikti) && arsivYok && (!tsBos || r.iz.length === 0), `kod ${r.kod} · iz ${r.iz.length} · ${r.dosyalar.join(',')} · ${r.cikti.split('\n').filter((l) => /✖|-/.test(l)).slice(0, 4).join(' | ')}`);
}
{
  const g = (ad, o) => backendZip(path.join(yol('b', ad), path.basename(BACKEND)), o);
  dur('§4a eski kanal paketi (backendKanal adnansahin)', kos({ '--backend': g('kanal', { paket: { backendKanal: 'adnansahin' } }) }), /ORTAK PAKET DEĞİL/);
  dur('§4a2 O11a öncesi kanal-dışı paket (backendKanal boş dize)', kos({ '--backend': g('bos', { paket: { backendKanal: '' } }) }), /ORTAK PAKET DEĞİL/);
  dur('§4a3 filigranda müşteri (eski yol derlemesi)', kos({ '--backend': g('filigran', { kunye: { musteri: 'adnansahin' } }) }), /filigranda müşteri\/kurulum/);
  dur('§4a4 filigranda kurulum kimliği', kos({ '--backend': g('kurulum', { kunye: { kurulumId: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' } }) }), /filigranda müşteri\/kurulum/);
  dur('§4a5 hizmet adı son ekli (kanal kimliği)', kos({ '--backend': g('sonek', { paket: { backendHizmetAdi: `${HIZMET_ADI}-test` } }) }), /dağıtım kaydı/);
  dur('§4a6 --musteri verildi (kalktı)', kos({ '--musteri': 'adnansahin' }), /--musteri kalktı/, { kod: 2 });
  const pgj = yol('pgj', 'pg.json');
  yaz(pgj, pgKunye({ ad: PG_AD, boyut: PG_VERI.length, sha256: 'f'.repeat(64) }));
  dur('§4b pg.json özeti PG zip\'ine uymuyor', kos({ '--pg-kunye': pgj }), /pg\.json özeti PG zip'ine UYMUYOR/);
  dur('§4c imzasız backend (butunluk.jws yok)', kos({ '--backend': g('imzasiz', { imzali: false }) }), /İMZASIZ/);
  dur('§4d imza geçersiz (doğrulayıcı reddeder)', kos({}, { senaryo: 'gecersiz' }), /İMZA DOĞRULANAMADI/, { tsBos: false });
  dur('§4e imzalı künye başka PG zip\'ini gösterir', kos({}, { senaryo: 'baska-pg' }), /başka bir PG zip/, { tsBos: false });
  dur('§4f derlemenin çapa kipi üretim değil', kos({ '--backend': g('capa', { kunye: { guvenCapasi: 'hazirlik' } }) }), /çapa kipi/);
  dur('§4g korumasız paket', kos({ '--backend': g('korumasiz', { paket: { korumali: false } }) }), /KORUMALI win-x64 değil/);
  dur('§4h PROVA paketi (bayraksız)', kos({ '--backend': g('prova', { paket: { prova: true } }) }), /PROVA paketi/);
  dur('§4i hizmet ikilisi zip\'te yok', kos({ '--backend': g('ikili', { cikar: ['runtime/tekserp-guncelleyici.exe'] }) }), /hizmet ikilisi zip'te yok/);
  dur('§4j hizmet adı yok (pm2 dönemi)', kos({ '--backend': g('pm2', { paket: { backendHizmetAdi: null } }) }), /Dağıtım v2 öncesi/);
  const boru = path.join(yol('s'), 'TeksERP-Kurulum-9.9.9-boru-sinamasi.exe');
  yaz(boru, pe('boru'));
  dur('§4k setup CI boru öz-sınaması', kos({ '--setup': boru }), /öz-sınaması/);
  const html = path.join(yol('s2'), 'TeksERP-Kurulum-9.9.9.exe');
  yaz(html, '<html>404</html>');
  dur('§4l setup PE değil', kos({ '--setup': html }), /PE\) değil/);
  const yanlisAd = path.join(yol('s3'), 'pg-kunye.json');
  yaz(yanlisAd, fs.readFileSync(PGJSON));
  dur('§4m pg.json adı farklı (setup yalnız pg.json arar)', kos({ '--pg-kunye': yanlisAd }), /setup yalnız "pg\.json" arar/);
  const sir = path.join(yol('t1'), 'etkili.tkpub');
  yaz(sir, `${tkpub()}tksec1:${'A'.repeat(48)}\n`);
  dur('§4n tkpub özel anahtar taşıyor', kos({ '--tkpub': sir }), /ÖZEL anahtar/);
  const bozuk = path.join(yol('t2'), 'etkili.tkpub');
  yaz(bozuk, tkpub().replace(/tkpub1:(.)/, (_, c) => `tkpub1:${c === 'A' ? 'B' : 'A'}`));
  dur('§4o tkpub sağlaması tutmuyor', kos({ '--tkpub': bozuk }), /sağlama tutmuyor/);
  const pgFazla = zipYap(path.join(yol('p'), PG_AD), { 'TEKSERP-ICERIK.sha256': MANIFESTO, ...SAHNE, 'bin/fazla.exe': pe('x') });
  const pgjf = yol('p', 'pg.json');
  yaz(pgjf, pgKunye({ ad: PG_AD, boyut: fs.statSync(pgFazla).size, sha256: sha(fs.readFileSync(pgFazla)) }));
  dur('§4p PG zip kayıttan sapar (pg-paketle --dogrula)', kos({ '--pg': pgFazla, '--pg-kunye': pgjf }), /PG zip kayıtla eşit değil/);
  dur('§4q girdi iki kez', kos({}, { args: ['--setup', SETUP, '--backend', BACKEND, '--pg', PG, '--pg', PG, '--pg-kunye', PGJSON, '--cikti', yol('c-iki')] }), /TEK verilir/, { kod: 2 });
  dur('§4r girdi yok', kos({ '--pg': path.join(GIRDI, 'postgresql-yok.zip') }), /--pg yok/);
  dur('§4s aynı dosya iki girdiye', kos({ '--tkpub': PGJSON }), /AYNI dosya/);
  dur('§4t çıktı depo içinde', kos({ '--cikti': path.join(G, 'deploy', 'kurulum', 'cikti') }), /depo içinde olamaz/, { kod: 2 });
}

// §5 --prova
{
  const imzasiz = backendZip(path.join(yol('pr'), path.basename(BACKEND)), { imzali: false, paket: { prova: true } });
  const r = kos({ '--backend': imzasiz }, { prova: true });
  const ad = `TeksERP-Kurulum-${SURUM}-PROVA-IMZASIZ.zip`;
  check('§5a --prova + imzasız + PROVA paketi → 0, ad -PROVA-IMZASIZ, iki [PROVA] uyarısı, SONUC: PROVA-ARSIVI', r.kod === 0 && r.dosyalar.includes(ad) && (r.cikti.match(/\[PROVA\]/g) ?? []).length === 2 && /SONUC: PROVA-ARSIVI/.test(r.cikti), `kod ${r.kod} · ${r.dosyalar.join(',')} · ${r.cikti.slice(-300)}`);
  check('§5b imzasız backend\'de pg.json yalnız `pg-dogrula`yla (üretim çapası), test çapası geçmez', r.iz.length === 1 && r.iz[0].komut === 'pg-dogrula' && r.iz[0].f['guven-capasi'] === 'uretim' && r.iz[0].testCapasi === null, JSON.stringify(r.iz).slice(0, 200));
  const g = kos({}, { prova: true, senaryo: 'gecersiz' });
  check('§5c --prova kipinde geçersiz imza UYARI kalır (0), ad yine -PROVA-IMZASIZ', g.kod === 0 && g.dosyalar.includes(ad) && /\[PROVA\] İMZA DOĞRULANAMADI/.test(g.cikti), `kod ${g.kod}`);
  const k = kos({ '--backend': backendZip(path.join(yol('pr2'), path.basename(BACKEND)), { paket: { backendKanal: 'testfabrika' } }) }, { prova: true });
  check('§5d --prova yapısal kapıları GEVŞETMEZ (eski kanal paketi yine DUR)', k.kod === 1 && /ORTAK PAKET DEĞİL/.test(k.cikti), `kod ${k.kod}`);
}

// §6 desenler tek kaynak + üretilen arşivde çakışma yok
{
  const m = await import(BETIK);
  const metin = (rel) => fs.readFileSync(path.join(KOK, rel), 'utf8');
  const t = { kurulum: metin('deploy/kurulum/kurulum.ps1'), onOlcum: metin('deploy/kurulum/on-olcum.ps1'), iss: metin('deploy/kurulum/tekserp-kurulum.iss') };
  const d = m.girdiDesenleri(t);
  check('§6a desenler setup metninden: tekserp-backend-*.zip · postgresql-*.zip · pg.json · etkili.tkpub · TeksERP-Kurulum-<sürüm>.exe (-boru-sinamasi ayrı)',
    d.backend.joker === 'tekserp-backend-*.zip' && d.pg.joker === 'postgresql-*.zip' && d.pgKunye.joker === 'pg.json' && d.tkpub.joker === 'etkili.tkpub' && d.setup.onek === 'TeksERP-Kurulum-' && d.setup.sonek === '-boru-sinamasi', JSON.stringify({ b: d.backend.joker, p: d.pg.joker, k: d.pgKunye.joker, t: d.tkpub.joker, s: d.setup.onek }));
  const bozuk = (ne, ac) => {
    try {
      m.girdiDesenleri({ ...t, [ne]: ac(t[ne]) });
      return 'geçti';
    } catch (e) {
      return e.kod === 2 ? 'olculemedi' : `başka: ${e.message}`;
    }
  };
  const s1 = bozuk('kurulum', (x) => x.replace('GirdiCoz $C["paket.pg"]', 'PaketBul $C["paket.pg"]'));
  const s2 = bozuk('onOlcum', (x) => x.replaceAll('"etkili.tkpub"', '"etkili.anahtar"'));
  const s3 = bozuk('iss', (x) => x.replace('OutputBaseFilename=TeksERP-Kurulum-{#KurulumSurumu}\n', 'OutputBaseFilename=Kurulum\n'));
  check('§6b setup metninde desenin yeri değişirse ÖLÇÜLEMEDİ (sessiz yedek yok)', s1 === 'olculemedi' && s2 === 'olculemedi' && s3 === 'olculemedi', `${s1} · ${s2} · ${s3}`);
  const uyeler = ['BENIOKU.txt', 'SHA256SUMS', 'TeksERP-Kurulum-9.9.9.exe', 'etkili.tkpub', 'pg.json', PG_AD, path.basename(BACKEND)];
  const say = (x) => uyeler.filter((u) => x.desen.test(u)).length;
  check('§6c üretilen arşivin üyelerinde her setup deseni TAM bir dosya (SHA256SUMS/BENIOKU.txt çakışmaz)', say(d.backend) === 1 && say(d.pg) === 1 && say(d.pgKunye) === 1 && say(d.tkpub) === 1, `${say(d.backend)}/${say(d.pg)}/${say(d.pgKunye)}/${say(d.tkpub)}`);
}

// §7 doğrulayıcı koşamaz
{
  const r = kos({}, { tsxYok: true });
  dur('§7 doğrulayıcı koşamaz (tsx yok)', r, /ÖLÇÜLEMEDİ/, { kod: 2, tsBos: true });
}

// §8 dağıtım kaydı tek kaynak: okunamazsa ÖLÇÜLEMEDİ, ortak kimliği bozuksa DUR (kanal kaydına sessiz dönüş yok)
{
  const k = path.join(G, 'deploy/dagitim.json');
  const asil = fs.readFileSync(k);
  try {
    fs.rmSync(k);
    dur('§8a dağıtım kaydı yok', kos(), /ÖLÇÜLEMEDİ/, { kod: 2 });
    const o = JSON.parse(asil.toString('utf8'));
    o.urun.backend.hizmetAdi = `${HIZMET_ADI}-test`;
    fs.writeFileSync(k, JSON.stringify(o));
    dur('§8b dağıtım kaydında hizmet adı son ekli', kos(), /dağıtım kaydı: .*soneksiz taban/);
  } finally {
    fs.writeFileSync(k, asil);
  }
}

console.log(`\n=== Sonuç: ${gecti} geçti, ${kaldi} başarısız ===`);
process.exit(kaldi > 0 ? 1 : 0);
