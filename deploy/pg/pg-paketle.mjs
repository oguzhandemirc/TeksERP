#!/usr/bin/env node
// =============================================================================
// KENDİ PostgreSQL ÖRNEĞİ — sahaya giden PG PAKETİNİ üret (+ isteğe bağlı imza)
// =============================================================================
// setup.exe'nin yanına giden `postgresql-<surum>-<derleme>-tekserp.zip` + `pg.json` buradan doğar.
//   1. EDB zip'i önbellekten (yoksa resmî kaynaktan) → `pg-ikili-dogrula.mjs` alt süreç olarak: boyut +
//      SHA256 + içerik + sahne manifestosu kayıtla (deploy/pg/pg-surumu.json) birebir — doğrulama ikinci
//      kez yazılmaz. Önbellekteki dosya kayıtla uyuşmazsa DURUR (silinmez, yeniden indirilmez).
//   2. Sahne Info-ZIP `zip` ile paketlenir: bayt sıralı girdi, sabit zaman damgası (kaydın yayinTarihi,
//      UTC), 0644, ek alan ve dizin girdisi yok → aynı araçla aynı bayt.
//   3. Zip YENİDEN açılır: kök düzeni = kurulum-pg'nin açtığı dizin (manifesto kökte, `pgsql/` öneki yok,
//      bağ/dizin girdisi yok), her girdi manifestoya, manifesto kayda eşit; sapma = paket bırakılmaz.
//   4. `pg-paketi.json` künyesi; `--anahtar` varsa `backend-bildirim.ts pg-imzala` (parola TTY'den, bu
//      betik parolaya dokunmaz) + imzalı künye pakete karşı ölçülür; yoksa imza adımında DURUR, komutu basar.
// deploy/pg/ kirliyse DURUR: künyedeki commit paketi yeniden üretebilmeli.
//
//   node deploy/pg/pg-paketle.mjs --cikti <boş dizin> [--onbellek <dizin>] [--anahtar <PAKET anahtar dosyası>]
//   node deploy/pg/pg-paketle.mjs --dogrula <paket zip>     var olan paketi kayda karşı ölçer (üretmez)
//
// ÇIKIŞ: 0 paket + imza tamam (--dogrula: kayıtla eşit) · 1 doğrulama hatası (paket bırakılmaz) ·
//        2 ÖLÇÜLEMEDİ / kullanım · 3 paket hazır ve doğrulandı, İMZA BEKLİYOR (son satır `SONUC: IMZA-BEKLIYOR`).
// Belge: docs/design/KENDI-POSTGRESQL.md §3 · bekçi: node scripts/test_pg_paketle.mjs
// =============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ICERIK_DOSYASI, KOK, Olculemedi, SURUM_REL, dizinAdi, jsonOku, paketDosyaAdi, sha256, surumKaydiHatalari } from './lib/pg-ornegi.mjs';
import { zipAc } from './lib/zip-okuyucu.mjs';

const DOGRULAYICI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pg-ikili-dogrula.mjs');
const KUNYE = 'pg-paketi.json';
const KULLANIM = 'Kullanım: --cikti <boş dizin> [--onbellek <dizin>] [--anahtar <PAKET anahtar dosyası>] | --dogrula <paket zip>';
const IMZA_BEKLIYOR = 3;

function arg(ad) {
  const i = process.argv.indexOf(ad);
  if (i > 0) return process.argv[i + 1];
  const esit = process.argv.find((a) => a.startsWith(`${ad}=`));
  return esit ? esit.slice(ad.length + 1) : undefined;
}

function dur(kod, msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(kod);
}

const kabuk = (s) => (/^[\w./=:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
/** Hook içinden koşulursa GIT_DIR/GIT_INDEX_FILE başka ağacı gösterir. */
const gitsizOrtam = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

function kayitOku() {
  let kayit;
  try {
    kayit = jsonOku(SURUM_REL);
  } catch (e) {
    dur(2, e instanceof Olculemedi ? `ÖLÇÜLEMEDİ — ${e.message}` : e.message);
  }
  const kh = surumKaydiHatalari(kayit);
  if (kh.length) dur(2, `KAYIT KIRMIZI (${SURUM_REL}):\n    ${kh.join('\n    ')}\n    Önce: node scripts/test_pg_ornegi.mjs`);
  return kayit;
}

/** Künyeye giren commit; deploy/pg/ kirliyse paket o commit'ten yeniden üretilemez → DUR. */
function kaynakCommiti() {
  const git = (...a) => spawnSync('git', ['-C', KOK, ...a], { encoding: 'utf8', env: gitsizOrtam() });
  const h = git('rev-parse', '--verify', 'HEAD');
  if (h.error || h.status !== 0) dur(2, `ÖLÇÜLEMEDİ — betik commit'i okunamadı (git rev-parse HEAD): ${(h.stderr || h.error?.message || '').trim()}`);
  const s = git('status', '--porcelain', '--untracked-files=all', '--', 'deploy/pg');
  if (s.error || s.status !== 0) dur(2, `ÖLÇÜLEMEDİ — deploy/pg/ durumu okunamadı (git status): ${(s.stderr || s.error?.message || '').trim()}`);
  const kirli = s.stdout.split('\n').filter(Boolean);
  if (kirli.length) dur(1, `deploy/pg/ KİRLİ (${kirli.length}) — künyedeki commit bu paketi yeniden üretemez:\n    ${kirli.slice(0, 5).join('\n    ')}\n    Önce commit'le ya da değişikliği geri al.`);
  return h.stdout.trim();
}

function zipSurumu() {
  const r = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  if (r.error) dur(2, `ÖLÇÜLEMEDİ — Info-ZIP \`zip\` bulunamadı: ${r.error.message}`);
  const satir = r.stdout.split('\n').find((l) => /^This is Zip \d/.test(l));
  if (!satir) dur(2, 'ÖLÇÜLEMEDİ — `zip -v` Info-ZIP sürüm satırı vermedi (başka bir zip aracı?)');
  return satir.trim();
}

function dosyalariGez(kok, rel = '') {
  const cikti = [];
  for (const g of fs.readdirSync(path.join(kok, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${g.name}` : g.name;
    if (g.isDirectory()) cikti.push(...dosyalariGez(kok, r));
    else if (g.isFile()) cikti.push(r);
    else dur(1, `sahnede dosya/dizin dışı girdi: ${r}`);
  }
  return cikti;
}

const baytSirasi = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Belirlenimli zip: sıralı liste stdin'den, damga ve kip sabit, ZIPOPT/ZIP ortamı (Info-ZIP varsayılan seçenekleri) silinir. */
function zipYaz(sahne, hedefZip, damga) {
  const adlar = dosyalariGez(sahne).sort(baytSirasi);
  for (const rel of adlar) {
    const p = path.join(sahne, ...rel.split('/'));
    fs.chmodSync(p, 0o644);
    fs.utimesSync(p, damga, damga);
  }
  const ortam = { ...process.env, TZ: 'UTC' };
  delete ortam.ZIPOPT;
  delete ortam.ZIP;
  const r = spawnSync('zip', ['-q', '-X', '-D', '-6', hedefZip, '-@'], { cwd: sahne, input: `${adlar.join('\n')}\n`, env: ortam, encoding: 'utf8' });
  if (r.error) dur(2, `ÖLÇÜLEMEDİ — zip çalıştırılamadı: ${r.error.message}`);
  if (r.status !== 0) dur(2, `ÖLÇÜLEMEDİ — zip çıkış ${r.status}: ${(r.stderr || '').trim()}`);
  return adlar.length;
}

/**
 * Paketin kayda karşı ölçümü — kurulum-pg'nin (tekserp-guncelleyici) açıp yaptığı denetimin üretim tarafı:
 * zip hedef dizine OLDUĞU GİBİ açılır, manifesto kökte aranır, listede olmayan dosya reddedilir.
 */
function paketiOlc(zipYol, kayit) {
  const hedef = kayit.yayin['win-x64'];
  const hatalar = [];
  let zip;
  try {
    zip = zipAc(zipYol);
  } catch (e) {
    if (e instanceof Olculemedi) return { olculemedi: e.message };
    throw e;
  }
  try {
    const girdiler = new Map();
    for (const g of zip.girdiler) {
      if (g.ad.endsWith('/')) hatalar.push(`dizin girdisi: ${g.ad} (paket yalnız dosya taşır)`);
      else if (!/^[\x21-\x7e]+$/.test(g.ad) || /[\\:]/.test(g.ad) || g.ad.split('/').some((s) => s === '' || s === '.' || s === '..')) hatalar.push(`güvensiz ya da ASCII dışı yol: ${JSON.stringify(g.ad)}`);
      else if (g.yapan >> 8 === 3 && ((g.harici >>> 16) & 0o170000) === 0o120000) hatalar.push(`sembolik bağ girdisi: ${g.ad}`);
      else if (girdiler.has(g.ad)) hatalar.push(`aynı ad iki kez: ${g.ad}`);
      else girdiler.set(g.ad, g);
    }
    const mg = girdiler.get(ICERIK_DOSYASI);
    if (!mg) {
      const derin = [...girdiler.keys()].find((a) => a.endsWith(`/${ICERIK_DOSYASI}`));
      hatalar.push(derin ? `${ICERIK_DOSYASI} kökte değil (${derin}) — kurulum zip'i hedef dizine olduğu gibi açar, manifesto KÖKTE olmalı` : `${ICERIK_DOSYASI} yok (içerik manifestosu)`);
      return { hatalar };
    }
    const manifesto = zip.oku(mg);
    const icerikSha256 = sha256(manifesto);
    if (icerikSha256 !== kayit.sahne.icerikSha256) hatalar.push(`manifesto ${icerikSha256.slice(0, 16)}… — kayıt ${kayit.sahne.icerikSha256.slice(0, 16)}… (paket kaydın sahnesi değil)`);

    const liste = new Map();
    const metin = manifesto.toString('latin1');
    if (!metin.endsWith('\n')) hatalar.push('manifesto LF ile bitmiyor');
    let onceki = '';
    for (const satir of metin.split('\n').slice(0, -1)) {
      const m = /^([0-9a-f]{64}) {2}([\x21-\x7e]+)$/.exec(satir);
      if (!m) {
        hatalar.push(`manifesto satırı biçimsiz: ${JSON.stringify(satir.slice(0, 80))}`);
        continue;
      }
      if (m[2] <= onceki) hatalar.push(`manifesto bayt sırasında değil / tekrar: ${m[2]}`);
      onceki = m[2];
      liste.set(m[2], m[1]);
    }
    let acikBoyut = 0;
    for (const [rel, ozet] of liste) {
      const g = girdiler.get(rel);
      if (!g) {
        hatalar.push(`manifestodaki dosya pakette yok: ${rel}`);
        continue;
      }
      acikBoyut += g.acik;
      if (sha256(zip.oku(g)) !== ozet) hatalar.push(`${rel}: özet manifestoyla aynı değil`);
    }
    for (const ad of girdiler.keys()) if (ad !== ICERIK_DOSYASI && !liste.has(ad)) hatalar.push(`manifestoda olmayan girdi: ${ad}`);
    if (liste.size !== kayit.sahne.dosyaSayisi) hatalar.push(`manifesto ${liste.size} dosya — kayıt ${kayit.sahne.dosyaSayisi}`);
    if (acikBoyut !== kayit.sahne.boyut) hatalar.push(`açık boyut ${acikBoyut} B — kayıt ${kayit.sahne.boyut} B`);
    for (const rel of kayit.zorunlu.ikililer) if (!girdiler.has(rel)) hatalar.push(`zorunlu ikili kökte yok: ${rel}`);
    const icu = [...girdiler.keys()].map((a) => /^bin\/icuuc(\d+)\.dll$/.exec(a)?.[1]).filter(Boolean);
    if (icu.length !== 1 || icu[0] !== hedef.icuSurum) hatalar.push(`ICU [${icu.join(', ')}] — kayıt tek ${hedef.icuSurum} (kurulum ve pg-imzala tek bin/icuuc<N>.dll ister)`);
    return { hatalar, girdiSayisi: zip.girdiler.length, dosyaSayisi: liste.size, acikBoyut, icerikSha256 };
  } catch (e) {
    if (e instanceof Olculemedi) return { olculemedi: e.message };
    throw e;
  } finally {
    zip.kapat();
  }
}

function olcumuBas(o) {
  if (o.olculemedi) dur(2, `ÖLÇÜLEMEDİ — paket okunamadı: ${o.olculemedi}`);
  if (o.hatalar.length) {
    for (const x of o.hatalar.slice(0, 12)) console.error(`  ✖ ${x}`);
    if (o.hatalar.length > 12) console.error(`  … (+${o.hatalar.length - 12})`);
    return false;
  }
  return true;
}

function dogrulaKipi(kayit) {
  const zipYol = path.resolve(arg('--dogrula'));
  if (!fs.existsSync(zipYol)) dur(2, `paket yok: ${zipYol}`);
  const veri = fs.readFileSync(zipYol);
  console.log(`== PG paketi ölçümü: ${zipYol} ==`);
  console.log(`  boyut / sha256 : ${veri.length} B · ${sha256(veri)}`);
  const o = paketiOlc(zipYol, kayit);
  if (!olcumuBas(o)) dur(1, `PAKET KAYITLA EŞİT DEĞİL (${o.hatalar.length}) — PostgreSQL ${dizinAdi(kayit)}`);
  console.log(`  içerik         : ${o.dosyaSayisi} dosya + manifesto, ${o.acikBoyut} B açık, içerik özeti ${o.icerikSha256}`);
  console.log(`== kayıtla eşit (PostgreSQL ${dizinAdi(kayit)}) ==`);
}

/** Üretim PAKET anahtarının yolu — dosya OKUNMAZ, yalnız dizin listesinden adı alınır. */
function uretimAnahtari() {
  const dizin = path.join(os.homedir(), '.tekserp', 'satici-uretim', 'paket');
  let adlar = [];
  try {
    adlar = fs.readdirSync(dizin).filter((a) => a.endsWith('.paket.json')).sort();
  } catch {
    /* dizin yoksa yer tutucu basılır */
  }
  if (adlar.length === 1) return { yol: path.join(dizin, adlar[0]) };
  return { yol: path.join(dizin, '<kid>.paket.json'), not: adlar.length ? `dizinde ${adlar.length} anahtar dosyası var (${adlar.join(', ')}) — kanalın kipine uygun olanı yaz` : `${dizin} altında anahtar dosyası görülmedi — yolu düzelt` };
}

function imzaKomutu(zipYol, cikti, anahtar) {
  return `cd ${kabuk(path.join(KOK, 'Teks-Erp'))} && npx tsx scripts/backend-bildirim.ts pg-imzala ${kabuk(`--zip=${zipYol}`)} ${kabuk(`--anahtar=${anahtar}`)} ${kabuk(`--cikti=${cikti}`)}`;
}

function imzaliKunyeyiOlc(cikti, kunye) {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(path.join(cikti, 'sonuc.json'), 'utf8')).kunye;
  } catch (e) {
    dur(2, `ÖLÇÜLEMEDİ — pg-imzala sonucu okunamadı: ${e.message}`);
  }
  const fark = [];
  const esit = (ad, a, b) => String(a) !== String(b) && fark.push(`${ad}: imzalı ${a} · paket ${b}`);
  esit('paket.ad', s?.paket?.ad, kunye.paket.ad);
  esit('paket.boyut', s?.paket?.boyut, kunye.paket.boyut);
  esit('paket.sha256', s?.paket?.sha256, kunye.paket.sha256);
  esit('icerikSha256', s?.icerikSha256, kunye.icerikSha256);
  esit('surum', s?.surum, kunye.surum);
  esit('derleme', s?.derleme, kunye.derleme);
  esit('icuSurum', s?.icuSurum, kunye.icuSurum);
  if (fark.length) dur(1, `İMZALI KÜNYE PAKETLE AYNI DEĞİL — pg.json kullanılmaz:\n    ${fark.join('\n    ')}`);
}

function uret(kayit) {
  const hedef = kayit.yayin['win-x64'];
  const ciktiArg = arg('--cikti');
  if (!ciktiArg) dur(2, KULLANIM);
  const cikti = path.resolve(ciktiArg);
  const anahtar = arg('--anahtar') ? path.resolve(arg('--anahtar')) : null;
  if (anahtar && !fs.statSync(anahtar, { throwIfNoEntry: false })?.isFile()) dur(2, `anahtar dosyası yok: ${anahtar}`);
  if (fs.existsSync(cikti) && fs.readdirSync(cikti).length) dur(2, `çıktı dizini boş değil: ${cikti} — paket, künye ve pg.json yan yana ve TEK olmalı (kurulum klasörde tek postgresql-*.zip + tek pg.json ister)`);
  const commit = kaynakCommiti();
  const zipAraci = zipSurumu();

  fs.mkdirSync(cikti, { recursive: true });
  const is = fs.mkdtempSync(path.join(cikti, '.pg-paketle-'));
  process.on('exit', () => fs.rmSync(is, { recursive: true, force: true }));

  const onbellek = path.resolve(arg('--onbellek') ?? path.join(os.tmpdir(), 'tekserp-pg'));
  const edb = path.join(onbellek, hedef.dosya);
  const onbellekte = fs.existsSync(edb);
  console.log(`== PG paketi: PostgreSQL ${dizinAdi(kayit)} (commit ${commit.slice(0, 12)}) ==`);
  console.log(onbellekte ? `  EDB zip'i önbellekten: ${edb} (kayıtla uyuşmazsa DURUR; dosya silinmez, yeniden indirilmez)` : `  önbellekte yok → resmî kaynaktan indirilecek: ${onbellek}`);
  const sahneKok = path.join(is, 'sahne');
  const d = spawnSync(process.execPath, [DOGRULAYICI, ...(onbellekte ? ['--zip', edb] : ['--indir', '--onbellek', onbellek]), '--sahne', sahneKok], { stdio: 'inherit' });
  if (d.status !== 0) dur(d.status === 1 ? 1 : 2, `EDB zip'i doğrulanamadı (pg-ikili-dogrula çıkış ${d.status ?? d.signal}) — paket üretilmedi`);
  const sahne = path.join(sahneKok, dizinAdi(kayit));

  const ad = paketDosyaAdi(kayit);
  const gecici = path.join(is, ad);
  const damga = new Date(`${kayit.yayinTarihi}T00:00:00Z`);
  const n = zipYaz(sahne, gecici, damga);
  console.log(`  zip            : ${n} girdi, damga ${damga.toISOString()} (${zipAraci})`);

  const o = paketiOlc(gecici, kayit);
  if (!olcumuBas(o)) dur(1, `PAKET DOĞRULAMASI BAŞARISIZ (${o.hatalar.length}) — paket bırakılmadı.`);
  const veri = fs.readFileSync(gecici);
  const zipYol = path.join(cikti, ad);
  fs.renameSync(gecici, zipYol);
  const kunye = {
    v: 1,
    tur: 'pg-paketi',
    cizgi: kayit.cizgi,
    surum: kayit.surum,
    derleme: kayit.derleme,
    icuSurum: hedef.icuSurum,
    paket: { ad, boyut: veri.length, sha256: sha256(veri) },
    icerikSha256: o.icerikSha256,
    dosyaSayisi: o.dosyaSayisi,
    acikBoyut: o.acikBoyut,
    edb: { dosya: hedef.dosya, boyut: hedef.boyut, sha256: hedef.sha256 },
    uretim: { betikCommit: commit, zaman: new Date().toISOString(), zipDamgasi: damga.toISOString(), zipAraci, node: process.version, platform: `${process.platform}-${process.arch}` },
  };
  fs.writeFileSync(path.join(cikti, KUNYE), `${JSON.stringify(kunye, null, 2)}\n`);
  console.log('== PG paketi hazır ve doğrulandı ==');
  console.log(`  paket          : ${zipYol}`);
  console.log(`  boyut          : ${kunye.paket.boyut} B`);
  console.log(`  sha256         : ${kunye.paket.sha256}`);
  console.log(`  içerik özeti   : ${kunye.icerikSha256} (= kayıt sahne.icerikSha256)`);
  console.log(`  künye          : ${path.join(cikti, KUNYE)}`);

  if (anahtar) {
    console.log(`\n  imza: pg-imzala (parola TTY'den sorulur)\n    ${imzaKomutu(zipYol, cikti, anahtar)}`);
    const r = spawnSync('npx', ['tsx', 'scripts/backend-bildirim.ts', 'pg-imzala', `--zip=${zipYol}`, `--anahtar=${anahtar}`, `--cikti=${cikti}`], { cwd: path.join(KOK, 'Teks-Erp'), stdio: 'inherit' });
    if (r.status !== 0) dur(2, `pg-imzala çıkış ${r.status ?? r.signal} — paket yerinde, pg.json YOK; yukarıdaki komutu elle koş`);
    imzaliKunyeyiOlc(cikti, kunye);
    console.log(`  pg.json        : ${path.join(cikti, 'pg.json')} (künye pakete eşit)`);
    console.log('SONUC: IMZALANDI');
    return;
  }
  const a = uretimAnahtari();
  console.log('\n  İMZA BEKLİYOR — paket hazır, pg.json YOK (setup pg.json olmadan kurmaz). Satıcı Mac\'inde, TTY\'de:');
  console.log(`    ${imzaKomutu(zipYol, cikti, a.yol)}`);
  if (a.not) console.log(`    (${a.not})`);
  console.log('  İmzadan sonra künyeyi pakete ve üretim çapasına karşı ölç:');
  console.log(`    cd ${kabuk(path.join(KOK, 'Teks-Erp'))} && npx tsx scripts/backend-bildirim.ts pg-dogrula ${kabuk(`--kunye=${path.join(cikti, 'pg.json')}`)} ${kabuk(`--zip=${zipYol}`)} --guven-capasi=uretim ${kabuk(`--cikti=${cikti}-dogrula`)}`);
  console.log('SONUC: IMZA-BEKLIYOR');
  process.exit(IMZA_BEKLIYOR);
}

function main() {
  const kayit = kayitOku();
  if (arg('--dogrula')) return dogrulaKipi(kayit);
  return uret(kayit);
}

try {
  main();
} catch (e) {
  console.error(`\n  ✖ BEKLENMEYEN HATA: ${e && e.stack ? e.stack : e}`);
  process.exit(2);
}
