#!/usr/bin/env node
// =============================================================================
// KENDİ PostgreSQL ÖRNEĞİ — EDB ikili zip'ini doğrula · (isteğe bağlı) indir · sahneye çıkar
// =============================================================================
// Kayıt TEK KAYNAK deploy/pg/pg-surumu.json. Zip imzasızdır (sunucu ikililerinde
// Authenticode yok) — güven zinciri: resmî HTTPS kaynağı + kayıttaki boyut/SHA256
// (iki ayrı ağdan ölçülür: sabitleyen makine + CI) + içerik denetimi; sahadaki kopya
// ise bizim PAKET imzamızla gider (docs/design/KENDI-POSTGRESQL.md §3).
//
//   node deploy/pg/pg-ikili-dogrula.mjs --zip <yol>                 yerel zip'i doğrula
//   node deploy/pg/pg-ikili-dogrula.mjs --indir [--onbellek <dizin>] resmî kaynaktan indir + doğrula
//        … --sahne <dizin>   doğrulanmış zip'ten sunucu alt kümesini <dizin>/<surum>-<derleme>/ altına çıkar
//   node deploy/pg/pg-ikili-dogrula.mjs --olc --surum <X.Y> --derleme <N> [--zip <yol>]
//        yeni sürüm sabitlerken: indir/ölç, kayda yapıştırılacak blokları bas (kayda bakmaz)
//
// ÇIKIŞ: 0 tamam · 1 doğrulama hatası · 2 ÖLÇÜLEMEDİ (kayıt/argüman/okuma/ağ).
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ICERIK_DOSYASI, IZINLI_KAYNAK, Olculemedi, SURUM_REL, dizinAdi, edbDosyaAdi, jsonOku, sha256, surumKaydiHatalari } from './lib/pg-ornegi.mjs';
import { peImzasi, zipAc } from './lib/zip-okuyucu.mjs';

function arg(ad) {
  const i = process.argv.indexOf(ad);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const bayrak = (ad) => process.argv.includes(ad);

function dur(kod, msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(kod);
}

async function dosyaSha256(yol) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(yol), h);
  return h.digest('hex');
}

/** Akışla indirir (371 MB belleğe alınmaz); .part'a yazar, bitince adlandırır. */
async function indir(url, hedef) {
  const part = `${hedef}.part`;
  const yanit = await fetch(url, { redirect: 'follow' });
  if (!yanit.ok || !yanit.body) throw new Error(`HTTP ${yanit.status}`);
  await pipeline(Readable.fromWeb(yanit.body), fs.createWriteStream(part));
  fs.renameSync(part, hedef);
  return { lastModified: yanit.headers.get('last-modified'), etag: yanit.headers.get('etag') };
}

/** Sahne kuralı: dahil öneklerinden biri + hiçbir hariç ifadesi (arşiv köküne göreli). */
function sahneyeGirerMi(rel, sahne) {
  if (!sahne.dahil.some((d) => (d.endsWith('/') ? rel.startsWith(d) : rel === d))) return false;
  return !sahne.haric.some((r) => new RegExp(r).test(rel));
}

/** İçerik denetimi + sahne manifestosu. hatalar: doğrulama hatası listesi. */
function icerikOlc(zip, { surum, arsivKok, zorunlu, sahne }) {
  const hatalar = [];
  const kok = `${arsivKok}/`;
  const dosyalar = zip.girdiler.filter((g) => !g.ad.endsWith('/'));
  const yabanci = dosyalar.filter((g) => !g.ad.startsWith(kok));
  if (yabanci.length) hatalar.push(`${yabanci.length} girdi "${kok}" kökü dışında (ör. ${yabanci[0].ad})`);
  const adlar = new Map(dosyalar.map((g) => [g.ad.slice(kok.length), g]));

  for (const rel of zorunlu.ikililer) if (!adlar.has(rel)) hatalar.push(`zorunlu ikili yok: ${rel}`);
  const icu = [...adlar.keys()].map((r) => /^bin\/icuuc(\d+)\.dll$/.exec(r)).filter(Boolean).map((m) => m[1]);
  if (zorunlu.icu && icu.length !== 1) hatalar.push(`ICU tek sürüm değil: [${icu.join(', ')}] (tr_sort ICU ister)`);
  for (const u of zorunlu.uzantilar) {
    for (const rel of [`share/extension/${u}.control`, `lib/${u}.dll`]) if (!adlar.has(rel)) hatalar.push(`zorunlu uzantı dosyası yok: ${rel}`);
  }

  const imzalar = {};
  const surumDeseni = new RegExp(`\\(PostgreSQL\\) ${surum.replace('.', '\\.')}(?!\\d)`);
  for (const rel of zorunlu.ikililer) {
    const g = adlar.get(rel);
    if (!g) continue;
    const veri = zip.oku(g);
    const pe = peImzasi(veri);
    if (!pe.pe) hatalar.push(`${rel} PE ikilisi değil`);
    imzalar[rel] = pe.imzali ? `authenticode${pe.imzalayan ? ` (${pe.imzalayan})` : ''}` : 'yok';
    if (rel.endsWith('.exe') && !surumDeseni.test(veri.toString('latin1'))) hatalar.push(`${rel} "(PostgreSQL) ${surum}" dizgesini taşımıyor — zip beyan edilen sürüm değil`);
  }

  const secilen = [...adlar.entries()].filter(([rel]) => sahneyeGirerMi(rel, sahne)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const asciiDisi = secilen.filter(([rel]) => /[^\x21-\x7e]/.test(rel));
  if (asciiDisi.length) hatalar.push(`sahnede ASCII dışı/boşluklu yol: ${asciiDisi[0][0]} (manifesto sırası diller arası bayt sırasıdır)`);
  let boyut = 0;
  const satirlar = [];
  for (const [rel, g] of secilen) {
    boyut += g.acik;
    satirlar.push(`${sha256(zip.oku(g))}  ${rel}`);
  }
  const manifesto = `${satirlar.join('\n')}\n`;
  return { hatalar, icu: icu[0] ?? null, imzalar, secilen, sahneBoyut: boyut, manifesto, icerikSha256: sha256(manifesto) };
}

function sahneYaz(zip, secilen, manifesto, hedefDizin) {
  if (fs.existsSync(hedefDizin)) dur(2, `sahne dizini zaten var (üzerine yazılmaz): ${hedefDizin}`);
  for (const [rel, g] of secilen) {
    const yol = path.join(hedefDizin, ...rel.split('/'));
    fs.mkdirSync(path.dirname(yol), { recursive: true });
    fs.writeFileSync(yol, zip.oku(g));
  }
  fs.writeFileSync(path.join(hedefDizin, ICERIK_DOSYASI), manifesto);
}

async function olcKipi() {
  const surum = arg('--surum');
  const derleme = arg('--derleme');
  if (!/^\d+\.\d+$/.test(surum ?? '') || !/^\d+$/.test(derleme ?? '')) dur(2, 'Kullanım: --olc --surum <X.Y> --derleme <N> [--zip <yol>]');
  const dosya = edbDosyaAdi(surum, derleme);
  const url = `${IZINLI_KAYNAK}${dosya}`;
  let zipYol = arg('--zip');
  let baslik = { lastModified: null, etag: null };
  if (!zipYol) {
    const dizin = arg('--onbellek') ?? path.join(os.tmpdir(), 'tekserp-pg');
    fs.mkdirSync(dizin, { recursive: true });
    zipYol = path.join(dizin, dosya);
    console.log(`  indir : ${url}`);
    try {
      baslik = await indir(url, zipYol);
    } catch (e) {
      dur(2, `indirilemedi: ${e.message}`);
    }
  }
  const kayit = jsonOku(SURUM_REL);
  const zip = zipAc(zipYol);
  const o = icerikOlc(zip, { surum, arsivKok: 'pgsql', zorunlu: kayit.zorunlu, sahne: kayit.sahne });
  zip.kapat();
  const imzaTurleri = [...new Set(Object.values(o.imzalar).map((x) => x.split(' ')[0]))];
  const blok = {
    surum,
    derleme,
    yayin: {
      'win-x64': {
        dosya,
        url,
        boyut: fs.statSync(zipYol).size,
        sha256: await dosyaSha256(zipYol),
        arsivKok: 'pgsql',
        icuSurum: o.icu,
        imza: imzaTurleri.length === 1 ? imzaTurleri[0] : `KARIŞIK (${imzaTurleri.join(', ')})`,
        olcum: { tarih: new Date().toISOString().slice(0, 10), lastModified: baslik.lastModified, etag: baslik.etag },
      },
    },
    sahne: { dosyaSayisi: o.secilen.length, boyut: o.sahneBoyut, icerikSha256: o.icerikSha256 },
  };
  console.log('\n  Kayda (deploy/pg/pg-surumu.json) yazılacak ölçümler — elle, gözden geçirerek:\n');
  console.log(JSON.stringify(blok, null, 2));
  if (o.hatalar.length) {
    console.log('\n  İçerik denetimi hataları (kayda geçmeden ÇÖZ):');
    for (const x of o.hatalar) console.log(`    ✖ ${x}`);
    process.exit(1);
  }
}

async function main() {
  if (bayrak('--olc')) return olcKipi();

  let kayit;
  try {
    kayit = jsonOku(SURUM_REL);
  } catch (e) {
    dur(2, e instanceof Olculemedi ? `ÖLÇÜLEMEDİ — ${e.message}` : e.message);
  }
  const kh = surumKaydiHatalari(kayit);
  if (kh.length) dur(2, `KAYIT KIRMIZI (${SURUM_REL}):\n    ${kh.join('\n    ')}\n    Önce: node scripts/test_pg_ornegi.mjs`);
  const hedef = kayit.yayin['win-x64'];

  let zipYol = arg('--zip');
  if (!zipYol && !bayrak('--indir')) dur(2, 'Kullanım: --zip <yol> | --indir [--onbellek <dizin>] [--sahne <dizin>]');
  if (!zipYol) {
    const dizin = arg('--onbellek') ?? path.join(os.tmpdir(), 'tekserp-pg');
    fs.mkdirSync(dizin, { recursive: true });
    zipYol = path.join(dizin, hedef.dosya);
    if (fs.existsSync(zipYol) && (await dosyaSha256(zipYol)) === hedef.sha256) {
      console.log(`  önbellek: ${zipYol} (özet kayıtla eşit — yeniden indirilmedi)`);
    } else {
      fs.rmSync(zipYol, { force: true });
      console.log(`  indir : ${hedef.url}`);
      try {
        await indir(hedef.url, zipYol);
      } catch (e) {
        dur(2, `indirilemedi: ${e.message}`);
      }
    }
  }
  if (!fs.existsSync(zipYol)) dur(2, `zip yok: ${zipYol}`);

  console.log(`== PostgreSQL ${kayit.surum}-${kayit.derleme} (${hedef.dosya}) ==`);
  const boyut = fs.statSync(zipYol).size;
  if (boyut !== hedef.boyut) dur(1, `BOYUT UYUŞMUYOR — kayıt ${hedef.boyut}, dosya ${boyut}. Kaynak değişmiş ya da indirme kesik; sahneye çıkarılmaz.`);
  const ozet = await dosyaSha256(zipYol);
  if (ozet !== hedef.sha256) dur(1, `SHA256 UYUŞMUYOR — kayıt ${hedef.sha256.slice(0, 16)}… dosya ${ozet.slice(0, 16)}…\n    Resmî kaynak değişmiş ya da dosya bozuk. Sahneye çıkarılmaz.`);
  console.log(`  boyut + sha256 : ✓ kayıtla eşit (${(boyut / 1e6).toFixed(1)} MB, ${ozet.slice(0, 16)}…)`);

  let zip;
  try {
    zip = zipAc(zipYol);
  } catch (e) {
    dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
  }
  let o;
  try {
    o = icerikOlc(zip, { surum: kayit.surum, arsivKok: hedef.arsivKok, zorunlu: kayit.zorunlu, sahne: kayit.sahne });
  } catch (e) {
    zip.kapat();
    dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
  }
  const hatalar = [...o.hatalar];
  if (o.icu !== hedef.icuSurum) hatalar.push(`ICU ${o.icu} — kayıt ${hedef.icuSurum} (ICU değişimi tr_sort index'lerinin yeniden kurulmasını ister)`);
  const imzaFarki = Object.entries(o.imzalar).filter(([, v]) => v.split(' ')[0] !== hedef.imza);
  if (imzaFarki.length) hatalar.push(`imza durumu kayıttan farklı (${hedef.imza}): ${imzaFarki.map(([r, v]) => `${r}=${v}`).join(', ')}`);
  if (o.secilen.length !== kayit.sahne.dosyaSayisi) hatalar.push(`sahne ${o.secilen.length} dosya — kayıt ${kayit.sahne.dosyaSayisi}`);
  if (o.sahneBoyut !== kayit.sahne.boyut) hatalar.push(`sahne ${o.sahneBoyut} bayt — kayıt ${kayit.sahne.boyut}`);
  if (o.icerikSha256 !== kayit.sahne.icerikSha256) hatalar.push(`sahne manifestosu ${o.icerikSha256.slice(0, 16)}… — kayıt ${kayit.sahne.icerikSha256.slice(0, 16)}…`);

  console.log(`  içerik         : ${kayit.zorunlu.ikililer.length} zorunlu ikili · ICU ${o.icu} · uzantı ${kayit.zorunlu.uzantilar.join(', ')} · imza "${hedef.imza}"`);
  console.log(`  sahne          : ${o.secilen.length} dosya, ${(o.sahneBoyut / 1e6).toFixed(1)} MB, manifesto ${o.icerikSha256.slice(0, 16)}…`);
  if (hatalar.length) {
    zip.kapat();
    for (const x of hatalar) console.error(`  ✖ ${x}`);
    dur(1, `İÇERİK DOĞRULAMASI BAŞARISIZ (${hatalar.length}) — sahneye çıkarılmaz.`);
  }

  const sahne = arg('--sahne');
  if (sahne) {
    const hedefDizin = path.join(sahne, dizinAdi(kayit));
    sahneYaz(zip, o.secilen, o.manifesto, hedefDizin);
    console.log(`  sahneye çıktı  : ${hedefDizin} (+ ${ICERIK_DOSYASI})`);
  }
  zip.kapat();
  console.log('== doğrulandı ==');
}

main().catch((e) => {
  console.error(`\n  ✖ BEKLENMEYEN HATA: ${e && e.stack ? e.stack : e}`);
  process.exit(2);
});
