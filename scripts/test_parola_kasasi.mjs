#!/usr/bin/env node
// =============================================================================
// BEKÇİ — PAROLA KASASI (tören/imza parolaları macOS Anahtar Zinciri'nden; `scripts/lib/parola-kasasi.mjs`)
// =============================================================================
// Gerçek Anahtar Zinciri'ne DOKUNMAZ: her koşum geçici dizinde SAHTE `security` kurar (`TEKSERP_PAROLA_KASASI=sahte:…`),
// sahte argv'yi deftere yazar. Bölümler:
//   §1 tek kaynak — mjs kataloğu/sabitleri/kid eşlemesi = cli-girdi.ts'in TS kopyası (iki ayna bayt-eşit)
//   §2 mjs yardımcısı — okur, kayıt yoksa null + ipucu (değer yok), biçimsiz kayıt değer basmadan RED, `kapali`/geçici dizin dışı sahte
//   §3 kayıt aracı — iki giriş, eşleşmeme/kısa RED, değer yalnız `security -i` stdin'inde, `--liste` değer basmaz,
//      kenar boşluğu atılır (içteki korunur), var olan kayıt `-U`suz sil+yaz, silme sonrası yazım hatası açıkça söylenir
//   §4 TS aracı (panel-imza) — kasadan sorusuz üretir/açar, `--kasa=yok`/`kapali` kasaya bakmaz, kayıt yoksa ipucu
//   §5 tripwire — parola girdisi olan her araç kasa yolunda; `askPassword` kasasız çağrı beyanlı; keytool argv'de parola yok;
//      Play parolası keystore.properties'ten okunmaz; araç koşturan her bekçi kasayı kapatır
//   §6 negatif sondalar — tripwire işlevleri bozuk girdide KIRMIZI verir
// Çıkış: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ.
// =============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as K from './lib/parola-kasasi.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEKS = path.join(KOK, 'Teks-Erp');
const require = createRequire(path.join(TEKS, 'package.json'));
let ts;
try {
  ts = require('typescript');
} catch {
  console.error('ÖLÇÜLEMEDİ: Teks-Erp/node_modules/typescript yok');
  process.exit(2);
}
if (!fs.existsSync(path.join(TEKS, 'node_modules', 'tsx'))) {
  console.error('ÖLÇÜLEMEDİ: Teks-Erp/node_modules/tsx yok');
  process.exit(2);
}

const T = {
  ASK: '§5a askPassword: her çağrı kasa adı verir ya da beyanlıdır (KASASIZ_ASK)',
  ISTEM: '§5b gizli TTY istemi (setRawMode) olan her araç kasa yolunda ya da beyanlı (ISTEM_BEYANI)',
  KEYTOOL: '§5c keytool/jarsigner argv\'sinde düz -storepass/-keypass YOK (yalnız :env/:file)',
  PROPS: '§5d keystore.properties parola alanını yalnız beyanlı dosyalar okur (Play parolası kasadan)',
  BEKCI: '§5e parola okuyan araç koşturan her bekçi kasayı kapatır (TEKSERP_PAROLA_KASASI)',
  ARAC: '§5f mjs araçları kasa yolunu çağırır (tören · OTA · mobil grup · build-apk)',
};

let gecen = 0;
let kalan = 0;
function check(ad, ok, ayrinti = '') {
  if (ok) gecen++;
  else kalan++;
  console.log(`${ok ? '✅' : '❌'} ${ad}${!ok && ayrinti ? ` — ${ayrinti}` : ''}`);
}

// ---------------------------------------------------------------- sahte security
const GECICI = fs.mkdtempSync(path.join(os.tmpdir(), 'parola-kasasi-'));
const SAHTE = path.join(GECICI, 'security');
const DEFTER = path.join(GECICI, 'argv.log');
const KASA = path.join(GECICI, 'kasa.json');
fs.writeFileSync(
  SAHTE,
  `#!${process.execPath}
const fs = require('fs');
const DB = ${JSON.stringify(KASA)};
const LOG = ${JSON.stringify(DEFTER)};
const BOZ = ${JSON.stringify(path.join(GECICI, 'boz-'))};
const db = fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, 'utf8')) : {};
fs.appendFileSync(LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
function kos(a) {
  const al = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const k = al('-s') + '|' + al('-a');
  if (a[0] === 'find-generic-password') {
    if (!(k in db)) { process.stderr.write('security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\\n'); return 44; }
    if (a.includes('-w')) process.stdout.write(db[k] + '\\n');
    else process.stdout.write('keychain: "login"\\nattributes: svce=' + al('-s') + '\\n');
    return 0;
  }
  if (a[0] === 'add-generic-password') {
    if (fs.existsSync(BOZ + 'ekle')) return 1;
    // var olan kayıtta -U: gerçek macOS izin penceresi açar — sahte kasa reddeder
    if (k in db) return a.includes('-U') ? 51 : 45;
    if (al('-T') !== '/usr/bin/security') return 3;
    db[k] = al('-w'); fs.writeFileSync(DB, JSON.stringify(db)); return 0;
  }
  if (a[0] === 'delete-generic-password') {
    if (fs.existsSync(BOZ + 'sil')) return 51;
    if (!(k in db)) return 44;
    delete db[k]; fs.writeFileSync(DB, JSON.stringify(db)); return 0;
  }
  return 1;
}
if (process.argv[2] === '-i') {
  let st = 0;
  for (const l of fs.readFileSync(0, 'utf8').split('\\n').filter(Boolean)) {
    const a = l.trim().split(/\\s+/);
    const w = a.indexOf('-w');
    fs.appendFileSync(LOG, JSON.stringify(['-i:', ...a.map((x, i) => (w >= 0 && i === w + 1 ? '***' : x))]) + '\\n');
    st = kos(a);
  }
  process.exit(st);
}
process.exit(kos(process.argv.slice(2)));
`,
  { mode: 0o700 },
);
const SAHTE_ORTAM = { ...process.env, [K.KASA_ORTAM]: `sahte:${SAHTE}` };
const kasaKoy = (kayitlar) => fs.writeFileSync(KASA, JSON.stringify(Object.fromEntries(Object.entries(kayitlar).map(([ad, deger]) => [`tekserp/${ad}|tekserp`, deger]))));
const kasaHam = () => (fs.existsSync(KASA) ? JSON.parse(fs.readFileSync(KASA, 'utf8')) : {});
const defter = () => (fs.existsSync(DEFTER) ? fs.readFileSync(DEFTER, 'utf8') : '');
const defterSifirla = () => fs.rmSync(DEFTER, { force: true });
const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
const kodla = (s) => `${K.KASA_BICIM}${hex(s)}`;

const PAROLA = 'Kasa-Sınaması-ğüşıöç-2026!';
const PAROLA_IKI = 'Başka-Parola-Yedek-2026#';

try {
  // ============================================================== §1 tek kaynak
  const cliKaynak = fs.readFileSync(path.join(KOK, 'satici/sunucu/scripts/lib/cli-girdi.ts'));
  const cliAyna = fs.readFileSync(path.join(TEKS, 'scripts/lib/cli-girdi.ts'));
  check('§1a cli-girdi.ts iki ayna BAYT-EŞİT (kasa bloğu dahil)', cliKaynak.equals(cliAyna));
  const sonda = path.join(GECICI, 'ts-sonda.ts');
  fs.writeFileSync(
    sonda,
    `import * as C from ${JSON.stringify(path.join(TEKS, 'scripts/lib/cli-girdi.ts'))};
const kidler = ${JSON.stringify(['kok-2026-1', 'kok-hazirlik-1', 'hazirlik-2026-1', 'ara-2026-1', 'ara-hazirlik-2026-1', 'paket-2026', 'paket-2026-2', 'paket-hazirlik', 'pkt-2026-1', 'pkt-hazirlik-1', 'ist-2026-1', 'ist-hazirlik-1', 'panel-2026', 'alt-2026-1', 'ind-2026-1', ''])};
console.log(JSON.stringify({ adlar: C.KASA_ADLARI, ortam: C.KASA_ORTAM, komut: C.KASA_KOMUTU, hesap: C.KASA_HESAP, onek: C.KASA_ONEK, bicim: C.KASA_BICIM, yok: C.KASA_BULUNAMADI, kayit: C.KAYIT_KOMUTU, kid: kidler.map((k) => [k, C.kasaAdiKid(k)]), ipucu: C.kasaIpucu("paket") }));
`,
  );
  const tsCikti = spawnSync(process.execPath, ['--import', 'tsx', sonda], { cwd: TEKS, encoding: 'utf8', env: { ...process.env, [K.KASA_ORTAM]: 'kapali' } });
  let tsDeger = null;
  try {
    tsDeger = JSON.parse(tsCikti.stdout.trim().split('\n').pop());
  } catch {
    // aşağıda kırmızı
  }
  check('§1b TS kopyası yüklenebiliyor', tsDeger !== null, tsCikti.stderr.slice(0, 300));
  if (tsDeger) {
    check('§1c katalog adları mjs = TS (sıra dahil)', JSON.stringify(tsDeger.adlar) === JSON.stringify(K.KASA_ADLARI), `${tsDeger.adlar} ≠ ${K.KASA_ADLARI}`);
    const sabitler = { ortam: K.KASA_ORTAM, komut: K.KASA_KOMUTU, hesap: K.KASA_HESAP, onek: K.KASA_ONEK, bicim: K.KASA_BICIM, yok: K.KASA_BULUNAMADI, kayit: K.KAYIT_KOMUTU };
    const farkli = Object.entries(sabitler).filter(([a, v]) => tsDeger[a] !== v).map(([a]) => a);
    check('§1d sabitler mjs = TS (ortam · komut · hesap · önek · biçim · bulunamadı · kayıt komutu)', farkli.length === 0, farkli.join(', '));
    const kidFark = tsDeger.kid.filter(([kid, ad]) => K.kasaAdiKid(kid) !== ad).map(([kid]) => kid);
    check('§1e kid → kasa eşlemesi mjs = TS (hazırlık kid\'i kasaya gitmez)', kidFark.length === 0 && K.kasaAdiKid('kok-hazirlik-1') === null && K.kasaAdiKid('paket-hazirlik') === null, kidFark.join(', '));
    check('§1f ipucu metni mjs = TS ve kayıt komutunun adını taşır', tsDeger.ipucu === K.kasaIpucu('paket') && tsDeger.ipucu.includes('parola-kaydet.mjs paket'));
  }
  check('§1g sahte security yalnız geçici dizinden; tanınmayan kip RED; macOS dışı ve `kapali` → kapalı', (() => {
    try {
      K.kasaKomutu({ [K.KASA_ORTAM]: 'sahte:/usr/bin/security' });
      return false;
    } catch (e) {
      if (!(e instanceof K.KasaHatasi)) return false;
    }
    try {
      K.kasaKomutu({ [K.KASA_ORTAM]: 'acik' });
      return false;
    } catch (e) {
      if (!(e instanceof K.KasaHatasi)) return false;
    }
    return K.kasaKomutu({}, 'linux') === null && K.kasaKomutu({ [K.KASA_ORTAM]: 'kapali' }, 'darwin') === null && K.kasaKomutu({}, 'darwin') === K.KASA_KOMUTU;
  })());

  // ============================================================== §2 mjs yardımcısı
  kasaKoy({ kok: kodla(PAROLA) });
  defterSifirla();
  const oku = K.kasadanOku('kok', SAHTE_ORTAM);
  check('§2a kayıtlı parola Buffer olarak döner (UTF-8 + NFC, Türkçe harf)', oku !== null && oku.toString('utf8') === PAROLA.normalize('NFC'));
  check('§2b okuma argv\'si yalnız hizmet adı + hesap + -w (değer argv\'de değil)', defter().trim() === JSON.stringify(['find-generic-password', '-s', 'tekserp/kok', '-a', 'tekserp', '-w']), defter().slice(0, 200));
  check('§2c kayıt yok → null (istem kararı çağırana)', K.kasadanOku('ara', SAHTE_ORTAM) === null);
  check('§2d kasa `kapali` → security HİÇ çağrılmaz', (() => {
    defterSifirla();
    return K.kasadanOku('kok', { [K.KASA_ORTAM]: 'kapali' }) === null && defter() === '';
  })());
  kasaKoy({ kok: `duz-${PAROLA}` });
  let bicimHata = '';
  try {
    K.kasadanOku('kok', SAHTE_ORTAM);
  } catch (e) {
    bicimHata = e.message;
  }
  check('§2e biçimsiz kayıt (`tkp1:` değil) RED ve ileti değeri TAŞIMAZ', bicimHata.includes('biçimi tanınmadı') && !bicimHata.includes(PAROLA) && bicimHata.includes('parola-kaydet.mjs kok'), bicimHata);
  check('§2f bilinmeyen kasa adı RED', (() => {
    try {
      K.kasaHizmeti('kok/../x');
      return false;
    } catch (e) {
      return e instanceof K.KasaHatasi;
    }
  })());
  check('§2g kasaSecimi: yok → null, ad → ad, verilmemiş → varsayılan, tanınmayan RED', K.kasaSecimi('yok', 'paket') === null && K.kasaSecimi('yedek', 'paket') === 'yedek' && K.kasaSecimi(undefined, 'paket') === 'paket' && (() => {
    try {
      K.kasaSecimi('', 'paket');
      return false;
    } catch {
      return true;
    }
  })());

  // ============================================================== §3 kayıt aracı
  const KAYDET = path.join(KOK, 'scripts/parola-kaydet.mjs');
  const kaydet = (argv, girdi) => spawnSync(process.execPath, [KAYDET, ...argv], { input: girdi, encoding: 'utf8', env: SAHTE_ORTAM });
  kasaKoy({});
  defterSifirla();
  const k1 = kaydet(['paket'], `${PAROLA}\n${PAROLA}\n`);
  const kayit = kasaHam()['tekserp/paket|tekserp'];
  check('§3a iki giriş eşleşince kaydedilir (çıkış 0) ve biçim tkp1:<hex>', k1.status === 0 && kayit === kodla(PAROLA.normalize('NFC')), `${k1.status} ${k1.stderr.slice(0, 200)}`);
  const argvSatirlari = defter().trim().split('\n').map((l) => JSON.parse(l));
  check('§3b değer argv\'ye GİRMEZ: yazım `security -i` (stdin), geri okuma -w', argvSatirlari.some((a) => a.length === 1 && a[0] === '-i') && !defter().includes(hex(PAROLA)) && !defter().includes(PAROLA), defter().slice(0, 300));
  check('§3c kayıt aracının çıktısında değer YOK (düz · hex)', ![k1.stdout, k1.stderr].some((c) => c.includes(PAROLA) || c.includes(hex(PAROLA))));
  const k2 = kaydet(['yedek'], `${PAROLA}\n${PAROLA_IKI}\n`);
  check('§3d iki giriş eşleşmezse kayıt YOK (çıkış 2)', k2.status === 2 && !('tekserp/yedek|tekserp' in kasaHam()));
  const k3 = kaydet(['kok'], 'kisa\nkisa\n');
  check('§3e katalog alt sınırından kısa parola RED (çıkış 2)', k3.status === 2 && !('tekserp/kok|tekserp' in kasaHam()));
  const k4 = kaydet(['--liste'], '');
  check('§3f --liste kayıtlıyı ✓, kayıtsızı — gösterir; değer basmaz', k4.status === 0 && /✓ kayıtlı\s+tekserp\/paket/.test(k4.stdout) && /— yok\s+tekserp\/kok/.test(k4.stdout) && !k4.stdout.includes(hex(PAROLA)) && !k4.stdout.includes(PAROLA), k4.stdout.slice(0, 300));
  const k5 = kaydet(['--parola=x'], '');
  const k6 = kaydet(['bilinmeyen'], '');
  check('§3g parola argümanı ve tanınmayan ad RED (çıkış 2)', k5.status === 2 && k6.status === 2);
  const k7 = spawnSync(process.execPath, [KAYDET, 'kok'], { input: `${PAROLA}\n${PAROLA}\n`, encoding: 'utf8', env: { ...process.env, [K.KASA_ORTAM]: 'kapali' } });
  check('§3h kasa kapalıyken kayıt yapılmaz (çıkış 2)', k7.status === 2);
  const degerYok = (r, ...degerler) => ![r.stdout, r.stderr].some((c) => degerler.some((d) => c.includes(d) || c.includes(hex(d))));
  kasaKoy({});
  const kb = kaydet(['yedek'], `  \u00a0${PAROLA}\t \n${PAROLA}\u00a0\n`);
  check('§3i kenar boşluğu (boşluk · sekme · NBSP) atılır, açıkça söylenir, değer basılmaz', kb.status === 0 && kasaHam()['tekserp/yedek|tekserp'] === kodla(PAROLA.normalize('NFC')) && /Kenar boşluğu atıldı/.test(kb.stderr) && degerYok(kb, PAROLA), `${kb.status} ${kb.stderr.slice(0, 200)}`);
  const OBEK = 'uzun kelime öbeği parola';
  const ko = kaydet(['ara'], `${OBEK}\n${OBEK}\n`);
  check('§3j içteki boşluk korunur; kenarı temiz değerde kırpma iletisi YOK', ko.status === 0 && kasaHam()['tekserp/ara|tekserp'] === kodla(OBEK) && !/Kenar boşluğu/.test(ko.stderr), `${ko.status} ${ko.stderr.slice(0, 200)}`);
  kasaKoy({ paket: kodla(PAROLA_IKI) });
  defterSifirla();
  const ku = kaydet(['paket'], `${PAROLA}\n${PAROLA}\n`);
  const altKomut = defter().trim().split('\n').map((l) => JSON.parse(l)).filter((a) => a[0] === '-i:' || a[0].endsWith('-generic-password'));
  const ekle = altKomut.filter((a) => a.includes('add-generic-password'));
  const silSira = altKomut.findIndex((a) => a[0] === 'delete-generic-password');
  check('§3k var olan kayıt -U\'suz: önce sil, sonra yaz (izin penceresi yok), yeni değer geri okunur', ku.status === 0 && kasaHam()['tekserp/paket|tekserp'] === kodla(PAROLA.normalize('NFC')) && silSira >= 0 && silSira < altKomut.indexOf(ekle[0]) && ekle.length === 1 && !ekle[0].includes('-U') && /eski kayıt silinip/.test(ku.stdout) && degerYok(ku, PAROLA, PAROLA_IKI), `${ku.status} ${ku.stderr.slice(0, 200)} ${JSON.stringify(altKomut).slice(0, 300)}`);
  kasaKoy({ paket: kodla(PAROLA_IKI) });
  fs.writeFileSync(path.join(GECICI, 'boz-ekle'), '');
  const ke = kaydet(['paket'], `${PAROLA}\n${PAROLA}\n`);
  fs.rmSync(path.join(GECICI, 'boz-ekle'));
  check('§3l silindi ama yazılamadı → çıkış 1, "ESKİ KAYIT SİLİNDİ … KAYITSIZ" + kayıt komutu söylenir, değer basılmaz', ke.status === 1 && !('tekserp/paket|tekserp' in kasaHam()) && /ESKİ KAYIT SİLİNDİ/.test(ke.stderr) && /KAYITSIZ/.test(ke.stderr) && ke.stderr.includes('parola-kaydet.mjs paket') && degerYok(ke, PAROLA, PAROLA_IKI), `${ke.status} ${ke.stderr.slice(0, 300)}`);
  kasaKoy({ paket: kodla(PAROLA_IKI) });
  fs.writeFileSync(path.join(GECICI, 'boz-sil'), '');
  const ks = kaydet(['paket'], `${PAROLA}\n${PAROLA}\n`);
  fs.rmSync(path.join(GECICI, 'boz-sil'));
  check('§3m eski kayıt silinemezse yazıma geçilmez: çıkış 1, kayıt DEĞİŞMEDİ', ks.status === 1 && kasaHam()['tekserp/paket|tekserp'] === kodla(PAROLA_IKI) && /DEĞİŞMEDİ/.test(ks.stderr) && degerYok(ks, PAROLA, PAROLA_IKI), `${ks.status} ${ks.stderr.slice(0, 300)}`);

  // ============================================================== §4 TS aracı uçtan uca (panel-imza)
  const DIZIN = path.join(GECICI, 'panel');
  const panel = (argv, ortam, girdi = '') => spawnSync(process.execPath, ['--import', 'tsx', 'scripts/panel-imza.ts', ...argv], { cwd: TEKS, input: girdi, encoding: 'utf8', env: ortam, timeout: 120_000 });
  kasaKoy({ istemci: kodla(PAROLA) });
  const u = panel(['anahtar-uret', '--kid=ist-2099-1', `--dizin=${DIZIN}`, '--json'], SAHTE_ORTAM);
  const dosya = path.join(DIZIN, 'ist-2099-1.panel.json');
  check('§4a yeni anahtar parolası kasadan, istemsiz (stdin boş) — dosya parolalı doğar', u.status === 0 && fs.existsSync(dosya), `${u.status} ${u.stderr.slice(0, 300)}`);
  const a = panel(['anahtar-ac', `--anahtar=${dosya}`, '--json'], SAHTE_ORTAM);
  check('§4b var olan anahtar kasadaki parolayla açılır (stdin boş)', a.status === 0 && /"acildi":true/.test(a.stdout), `${a.status} ${a.stderr.slice(0, 300)}`);
  check('§4c araç çıktısında değer YOK (düz · hex)', ![u.stdout, u.stderr, a.stdout, a.stderr].some((c) => c.includes(PAROLA) || c.includes(hex(PAROLA))));
  // §4d–§4h parola-kaydet --dogrula (fixture: yukarıda üretilen istemci anahtarı; dosya = gerçek anahtar değil, geçici)
  const dg = (ad, d, girdi) => kaydet([ad, `--dogrula=${d}`], girdi);
  kasaKoy({});
  const d1 = dg('istemci', dosya, `${PAROLA}\n${PAROLA}\n`);
  check('§4d --dogrula: doğru parola anahtarı açar → kasaya yazılır, değer basılmaz', d1.status === 0 && kasaHam()['tekserp/istemci|tekserp'] === kodla(PAROLA.normalize('NFC')) && /anahtar dosyasını açtı/.test(d1.stdout) && degerYok(d1, PAROLA), `${d1.status} ${d1.stderr.slice(0, 300)}`);
  kasaKoy({});
  const d2 = dg('istemci', dosya, `${PAROLA_IKI}\n${PAROLA_IKI}\n`);
  check('§4e --dogrula: yanlış parola → çıkış 1, kasaya YAZILMAZ', d2.status === 1 && !('tekserp/istemci|tekserp' in kasaHam()) && /AÇMIYOR/.test(d2.stderr) && degerYok(d2, PAROLA_IKI), `${d2.status} ${d2.stderr.slice(0, 300)}`);
  kasaKoy({ istemci: kodla(PAROLA) });
  const d3 = dg('istemci', dosya, `${PAROLA_IKI}\n${PAROLA_IKI}\n`);
  check('§4f --dogrula: yanlış parola mevcut kaydı BOZMAZ (silme/yazma yok)', d3.status === 1 && kasaHam()['tekserp/istemci|tekserp'] === kodla(PAROLA.normalize('NFC')));
  kasaKoy({});
  const d4 = dg('yedek', dosya, `${PAROLA}\n${PAROLA}\n`);
  const d5 = dg('paket', dosya, `${PAROLA}\n${PAROLA}\n`);
  const d6 = kaydet(['istemci', '--dogrula'], `${PAROLA}\n${PAROLA}\n`);
  const d7 = dg('istemci', path.join(GECICI, 'yok.json'), `${PAROLA}\n${PAROLA}\n`);
  check('§4g --dogrula fail-closed: eşlemesiz ad (yedek) · başka aile dosyası · dosyasız bayrak · dosya yok → çıkış 2, kasaya yazılmaz', [d4, d5, d6, d7].every((r) => r.status === 2) && Object.keys(kasaHam()).length === 0, `${[d4, d5, d6, d7].map((r) => r.status)}`);
  kasaKoy({});
  const d8 = kaydet(['istemci'], `${PAROLA_IKI}\n${PAROLA_IKI}\n`);
  check('§4h --dogrula YOKKEN davranış bugünkü gibi: doğrulanmadan yazılır', d8.status === 0 && kasaHam()['tekserp/istemci|tekserp'] === kodla(PAROLA_IKI.normalize('NFC')));
  defterSifirla();
  const y = panel(['anahtar-ac', `--anahtar=${dosya}`, '--kasa=yok', '--json'], SAHTE_ORTAM);
  check('§4d --kasa=yok → kasaya BAKILMAZ (stdin boş → RED)', y.status !== 0 && defter() === '' && /stdin bitti/.test(y.stderr), y.stderr.slice(0, 200));
  const kp = panel(['anahtar-ac', `--anahtar=${dosya}`, '--json'], { ...process.env, [K.KASA_ORTAM]: 'kapali' }, `${PAROLA}\n`);
  check('§4e kasa `kapali` → stdin satırı (geriye uyum)', kp.status === 0 && /"acildi":true/.test(kp.stdout), kp.stderr.slice(0, 200));
  kasaKoy({ istemci: kodla(PAROLA), yedek: kodla(PAROLA_IKI) });
  const yd = panel(['anahtar-ac', `--anahtar=${dosya}`, '--kasa=yedek', '--json'], SAHTE_ORTAM);
  check('§4f --kasa=yedek başka kaydı seçer (yanlış parola → açılmaz, değer basılmaz)', yd.status !== 0 && ![yd.stdout, yd.stderr].some((c) => c.includes(PAROLA_IKI) || c.includes(hex(PAROLA_IKI))), yd.stderr.slice(0, 200));
  kasaKoy({});
  const yok = panel(['anahtar-ac', `--anahtar=${dosya}`, '--json'], SAHTE_ORTAM);
  check('§4g kayıt yoksa: kayıt komutunun ADI basılır, istem/stdin yoluna düşer', yok.status !== 0 && yok.stderr.includes('parola-kaydet.mjs istemci'), yok.stderr.slice(0, 300));
  const dosyaParola = path.join(GECICI, 'parola.txt');
  fs.writeFileSync(dosyaParola, `${PAROLA}\n`, { mode: 0o600 });
  kasaKoy({ istemci: kodla(PAROLA_IKI) });
  defterSifirla();
  const pd = panel(['anahtar-ac', `--anahtar=${dosya}`, `--parola-dosyasi=${dosyaParola}`, '--json'], SAHTE_ORTAM);
  check('§4h açık --parola-dosyasi kasadan ÖNCE gelir (kasaya hiç bakılmaz)', pd.status === 0 && defter() === '', `${pd.status} ${pd.stderr.slice(0, 200)}`);

  // ============================================================== §5 tripwire
  const sonuc = tripwire(KOK);
  for (const [ad, hatalar] of sonuc) check(ad, hatalar.length === 0, hatalar.slice(0, 40).join(' · '));

  // ============================================================== §6 negatif sondalar
  const sondaKok = path.join(GECICI, 'sonda-kok');
  const yaz = (rel, icerik) => {
    fs.mkdirSync(path.dirname(path.join(sondaKok, rel)), { recursive: true });
    fs.writeFileSync(path.join(sondaKok, rel), icerik);
  };
  yaz('Teks-Erp/scripts/yeni-arac.ts', 'import { askPassword } from "./lib/cli-girdi";\nawait askPassword("Kök parolası: ");\n');
  yaz('deploy/yeni.mjs', "process.stdin.setRawMode(true);\nspawnSync('keytool', ['-list', '-storepass', p]);\n");
  yaz('mobil/scripts/lib/imza-yeni.cjs', "const p = props.storePassword;\n");
  yaz('scripts/test_yeni.mjs', "spawnSync(process.execPath, ['Teks-Erp/scripts/panel-imza.ts']);\n");
  yaz('Teks-Erp/docker/korumali/prova-yeni.mjs', "spawnSync(process.execPath, ['Teks-Erp/docker/korumali/imaj-imzala.mjs']);\n");
  const neg = new Map(tripwire(sondaKok, { sonda: true }));
  check('§6a SONDA: kasa adı verilmeyen beyansız askPassword → KIRMIZI', (neg.get(T.ASK) ?? []).some((h) => h.includes('yeni-arac.ts')));
  check('§6b SONDA: beyansız gizli TTY istemi olan yeni araç → KIRMIZI', (neg.get(T.ISTEM) ?? []).some((h) => h.includes('deploy/yeni.mjs')));
  check('§6c SONDA: keytool argv\'sinde düz -storepass → KIRMIZI', (neg.get(T.KEYTOOL) ?? []).some((h) => h.includes('deploy/yeni.mjs')));
  check('§6d SONDA: keystore.properties parola alanı yeni dosyada okunur → KIRMIZI', (neg.get(T.PROPS) ?? []).some((h) => h.includes('imza-yeni.cjs')));
  check('§6e SONDA: kasayı kapatmayan araç-koşturan bekçi → KIRMIZI', (neg.get(T.BEKCI) ?? []).some((h) => h.includes('test_yeni.mjs')));
  check('§6f SONDA: kasayı kapatmayan Docker imaj-imzala provası → KIRMIZI', (neg.get(T.BEKCI) ?? []).some((h) => h.includes('prova-yeni.mjs')));
} finally {
  fs.rmSync(GECICI, { recursive: true, force: true });
}

console.log(`\n${gecen} geçti · ${kalan} kaldı`);
process.exit(kalan === 0 ? 0 : 1);

// =============================================================================
// Tripwire — düz metin + TS AST; `sonda` kipinde yalnız verilen kökün dosyaları taranır.
// =============================================================================

/** Kasa adı vermeden `askPassword` çağırabilen yerler — dosya → beklenen çağrı sayısı (gerekçe). */
function KASASIZ_ASK() {
  return {
    'satici/sunucu/scripts/anahtar.ts': 1, // bayi anahtarı parolası: bayiye teslim edilen, bayi başına ayrı sır
    'satici/sunucu/scripts/portal-kullanici.ts': 2, // portal kullanıcısının giriş parolası: insan girişi
    'Teks-Erp/scripts/kisa-kimlik.ts': 1, // fabrika sunucusunda yedek anahtarı parolası: fabrika aracı
  };
}

/** Gizli TTY istemi kuran dosyalar: kasa yolunda olanlar ve gerekçeli muaflar. */
function ISTEM_BEYANI() {
  return {
    kasali: ['satici/sunucu/scripts/lib/cli-girdi.ts', 'Teks-Erp/scripts/lib/cli-girdi.ts', 'deploy/satici/uretim-toren.mjs', 'mobil/scripts/ota-zinciri.mjs', 'deploy/mobil-grup-yayinla.mjs'],
    muaf: {
      'scripts/parola-kaydet.mjs': 'kasaya YAZAN araç — parolayı insandan alır',
      'Teks-Erp/scripts/yedek-sifrele.ts': 'fabrika/satıcı yedek aracı (paketli .cjs, Windows); tören parolası değil',
    },
  };
}

function tara(kok, dizinler, uzantilar) {
  const out = [];
  const gez = (d) => {
    let girdiler;
    try {
      girdiler = fs.readdirSync(path.join(kok, d), { withFileTypes: true });
    } catch {
      return;
    }
    for (const g of girdiler) {
      if (g.name === 'node_modules' || g.name === 'dist' || g.name.startsWith('.')) continue;
      const rel = path.posix.join(d, g.name);
      if (g.isDirectory()) gez(rel);
      else if (g.isFile() && uzantilar.some((u) => g.name.endsWith(u))) out.push(rel);
    }
  };
  for (const d of dizinler) gez(d);
  return out;
}

function tripwire(kok, { sonda = false } = {}) {
  const sonuc = new Map(Object.values(T).map((ad) => [ad, []]));
  const ekle = (ad, h) => sonuc.get(ad).push(h);
  const oku = (rel) => fs.readFileSync(path.join(kok, rel), 'utf8');
  const DIZINLER = ['deploy', 'scripts', 'Teks-Erp/scripts', 'Teks-Erp/docker', 'satici/sunucu/scripts', 'mobil/scripts', 'mobil/plugins', 'patron/sunucu/scripts', 'Electron/scripts'];
  const dosyalar = tara(kok, DIZINLER, ['.ts', '.mjs', '.cjs', '.js']);
  const bekciMi = (rel) => /(^|\/)(?:test_|prova-)[^/]*$/.test(rel) || /\.test\.ts$/.test(rel);

  // §5a askPassword çağrıları (TS AST)
  const kasasiz = new Map();
  for (const rel of dosyalar.filter((r) => r.endsWith('.ts') && !bekciMi(r))) {
    const metin = oku(rel);
    if (!metin.includes('askPassword(') || !/import\s*\{[^}]*\baskPassword\b[^}]*\}\s*from\s*["']\.\/(?:lib\/)?cli-girdi["']/.test(metin)) continue;
    const sf = ts.createSourceFile(rel, metin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const gez = (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'askPassword' && n.arguments.length < 2) {
        kasasiz.set(rel, (kasasiz.get(rel) ?? 0) + 1);
      }
      ts.forEachChild(n, gez);
    };
    gez(sf);
  }
  const beyan = KASASIZ_ASK();
  for (const [rel, n] of kasasiz) if (beyan[rel] !== n) ekle(T.ASK, `${rel}: ${n} kasasız çağrı (beyan ${beyan[rel] ?? 0})`);
  if (!sonda) for (const [rel, n] of Object.entries(beyan)) if ((kasasiz.get(rel) ?? 0) !== n) ekle(T.ASK, `${rel}: beyan ${n}, ölçülen ${kasasiz.get(rel) ?? 0} (beyanı güncelle)`);

  // §5b gizli TTY istemi
  const ib = ISTEM_BEYANI();
  for (const rel of dosyalar.filter((r) => !bekciMi(r))) {
    const metin = oku(rel);
    if (!/setRawMode\(true\)/.test(metin)) continue;
    if (ib.muaf[rel]) continue;
    if (!ib.kasali.includes(rel)) {
      ekle(T.ISTEM, `${rel}: beyansız gizli istem — kasa yolunu bağla ve ISTEM_BEYANI.kasali'ye ekle`);
      continue;
    }
    if (!/kasadanAl\(|kasadanOku\(/.test(metin)) ekle(T.ISTEM, `${rel}: beyanlı ama kasaya bakmıyor`);
  }
  if (!sonda) for (const rel of [...ib.kasali, ...Object.keys(ib.muaf)]) if (!fs.existsSync(path.join(kok, rel))) ekle(T.ISTEM, `${rel}: beyanda var, dosya yok`);

  // §5c keytool/jarsigner argv
  for (const rel of dosyalar.filter((r) => r !== 'scripts/test_parola_kasasi.mjs')) {
    const metin = oku(rel);
    if (/['"]-(?:store|key)pass['"]/.test(metin)) ekle(T.KEYTOOL, `${rel}: düz -storepass/-keypass argv (parola süreç listesine düşer) — -storepass:env kullan`);
  }

  // §5d keystore.properties parola alanları
  const PROPS_BEYANI = {
    'mobil/scripts/lib/imza-anahtari.cjs': 'alanları DENETLER: Play türünde varsa RED',
    'mobil/scripts/build-apk.mjs': 'yalnız deneme (kasasız) türünün parolası',
    'mobil/plugins/withReleaseKeystore.js': 'Gradle: Play dalı ortamdan, deneme dalı dosyadan',
  };
  for (const rel of dosyalar.filter((r) => !bekciMi(r))) {
    const metin = oku(rel);
    if (/(?:\.|\[')(?:storePassword|keyPassword)\b/.test(metin) && !PROPS_BEYANI[rel]) ekle(T.PROPS, `${rel}: keystore.properties parola alanı okunuyor`);
  }
  if (!sonda) {
    const g = oku('mobil/plugins/withReleaseKeystore.js');
    if (!/System\.getenv\('\$\{IMZA_PAROLA_ORTAMI\}'\)/.test(g) || !/containsKey\('storePassword'\)/.test(g)) ekle(T.PROPS, 'withReleaseKeystore.js: Play dalı ortamdan okumuyor ya da dosyadaki düz parolayı reddetmiyor');
    const b = oku('mobil/scripts/build-apk.mjs');
    if (!/kasadanAl\(/.test(b) || !/'-storepass:env'/.test(b)) ekle(T.PROPS, 'build-apk.mjs: Play parolası kasadan değil ya da keytool ortamdan okumuyor');
  }

  // §5e araç koşturan bekçiler kasayı kapatır
  const ARACLAR = /build-korumali-imza|panel-imza\.ts|backend-bildirim|scripts\/anahtar\.ts|["']anahtar\.ts|uretim-toren|ota-zinciri\.mjs|OTA_ARACI|mobil-grup-yayinla|build-apk\.mjs|backend-yayinla|prova-paket-zinciri|parola-kaydet|imaj-imzala\.mjs['"]/;
  const bekciler = sonda ? dosyalar.filter(bekciMi) : [...dosyalar.filter(bekciMi), ...tara(kok, ['mobil/src/test'], ['.ts'])];
  for (const rel of bekciler) {
    if (rel === 'scripts/test_parola_kasasi.mjs') continue;
    const metin = oku(rel);
    if (/spawn|execFile|exec\(/.test(metin) && ARACLAR.test(metin) && !metin.includes('TEKSERP_PAROLA_KASASI')) ekle(T.BEKCI, `${rel}: parola okuyan aracı koşturuyor ama kasayı kapatmıyor (gerçek Anahtar Zinciri'ne gidebilir)`);
  }
  if (!sonda) {
    for (const rel of ['Teks-Erp/scripts/run-all-tests.ts', 'satici/sunucu/scripts/run-all-tests.ts', 'scripts/hooks/pre-commit.mjs', 'deploy/satici/prova-paket-zinciri.mjs', 'mobil/jest.config.js']) {
      if (!oku(rel).includes('TEKSERP_PAROLA_KASASI')) ekle(T.BEKCI, `${rel}: koşucu kasayı kapatmıyor`);
    }
  }

  // §5f mjs araçları
  if (!sonda) {
    const beklenen = {
      'deploy/satici/uretim-toren.mjs': [/kasadanAl\(ad\)/, /\[KASA_ORTAM\]: "kapali"/],
      'mobil/scripts/ota-zinciri.mjs': [/kasadanAl\(/, /'OTA kökü parolası: ', 'kok'\)/, /'istemci'\)/],
      'deploy/mobil-grup-yayinla.mjs': [/kasadanYaprak\(\) \?\?/],
      'mobil/scripts/build-apk.mjs': [/imzaParolasi\(IMZA_TURU\)/],
    };
    for (const [rel, desenler] of Object.entries(beklenen)) {
      const metin = oku(rel);
      for (const d of desenler) if (!d.test(metin)) ekle(T.ARAC, `${rel}: ${d} yok`);
    }
    const toren = oku('deploy/satici/uretim-toren.mjs');
    const yeniDogrudan = (toren.match(/\byeniParola\(/g) ?? []).length;
    const sorDogrudan = (toren.match(/parolaSor\(/g) ?? []).length;
    if (yeniDogrudan !== 2 || sorDogrudan !== 4) ekle(T.ARAC, `uretim-toren.mjs: istem kasa yolunu atlayarak çağrılıyor (yeniParola ${yeniDogrudan}/2 · parolaSor ${sorDogrudan}/4)`);
  }
  return [...sonuc];
}
