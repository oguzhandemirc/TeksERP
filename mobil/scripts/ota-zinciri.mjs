#!/usr/bin/env node
/**
 * TeksERP Tablet — OTA sertifika zinciri aracı (K-2 / I5). Tören bu araçla ölçer; anahtar ÜRETMEZ.
 *
 *   node scripts/ota-zinciri.mjs profil                                  # openssl uzantı profili (stdout)
 *   node scripts/ota-zinciri.mjs denetle [--kok=<pem>] [--yaprak=<pem>]   # kök CA + EKU'suz, yaprak CA değil + codeSigning + köke bağlı
 *
 * Tören (I7; openssl sarmalayıcı, parola openssl'e yalnız özel FIFO'dan — argv/ortam/disk değil):
 *   node scripts/ota-zinciri.mjs kok-uret --dizin=<tören anahtarlar dizini>          # OTA kökü, KÖK parolasıyla (yeni + tekrar)
 *   node scripts/ota-zinciri.mjs yaprak-bas --kok-anahtar=<pem> --kok=<pem> --hedef=<dizin> [--cn=<ad>] [--gun=395]
 *        # parolalar: OTA kökününki, sonra YENİ yaprak parolası (yeni + tekrar) → <hedef>/private-key.pem + certificate.pem
 *   node scripts/ota-zinciri.mjs yaprak-ac --anahtar=<private-key.pem> --kok=<pem> [--yaprak=<certificate.pem>] [--json]
 *   node scripts/ota-zinciri.mjs yeniden-imzala --manifest=<yayındaki manifest> --cikti=<yeni> --anahtar=<private-key.pem> --kok=<pem>
 * Parola: TTY'de gizli istem, değilse stdin satırı ya da `--parola-dosyasi=<yol>` (0600; her istenen parola bir satır).
 * Hiçbir komut parolayı ya da özel yarıyı basmaz.
 *
 * Varsayılan yollar ortak kimlikten (`deploy/dagitim.json` → `ortak-kimlik.cjs`). Çıkış: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ.
 * Kural ve gerekçe: docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.1, §3.5, §6 adım 3.
 */
import { Buffer } from 'node:buffer';
import crypto, { X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Z = require('./lib/ota-zinciri.cjs');
const { ortakKimlik } = require('./lib/ortak-kimlik.cjs');
const MOBIL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [komut, ...argv] = process.argv.slice(2);
const arg = (ad) => argv.find((a) => a.startsWith(`--${ad}=`))?.slice(ad.length + 3);
const dur = (m, kod = 1) => {
  console.error(`✖ ${m}`);
  process.exit(kod);
};
for (const a of argv) {
  const ad = /^--([a-z-]+)/.exec(a)?.[1] ?? '';
  if (/parola|password|sifre|secret/.test(ad) && ad !== 'parola-dosyasi') dur("Parola argümandan ALINMAZ — TTY'de sorulur, stdin'den ya da --parola-dosyasi=<yol> dosyasından okunur", 2);
}

/* Parola satırları: --parola-dosyasi (0600, bağ değil, bizim) > TTY gizli istem > stdin satırları. Buffer döner. */
let satirlar = null;
function satirlaraBol(b) {
  const out = [];
  let bas = 0;
  for (let i = 0; i <= b.length; i++) {
    if (i === b.length || b[i] === 0x0a) {
      let son = i;
      if (son > bas && b[son - 1] === 0x0d) son--;
      if (son > bas || i < b.length) out.push(Buffer.from(b.subarray(bas, son)));
      bas = i + 1;
    }
  }
  b.fill(0);
  return out;
}
const dosyaYolu = arg('parola-dosyasi');
if (dosyaYolu !== undefined) {
  let st;
  try {
    st = fs.lstatSync(dosyaYolu);
  } catch {
    dur('--parola-dosyasi: dosya okunamadı (yok ya da erişilemez)', 2);
  }
  if (!st.isFile()) dur('--parola-dosyasi: düzenli dosya değil (sembolik bağ ve dizin kabul edilmez)', 2);
  if ((st.mode & 0o077) !== 0) dur(`--parola-dosyasi: dosya grup/başkalarına açık (${(st.mode & 0o777).toString(8)}) — chmod 600`, 2);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) dur('--parola-dosyasi: dosya başka kullanıcının', 2);
  if (st.size === 0 || st.size > 4096) dur('--parola-dosyasi: dosya boş ya da çok büyük', 2);
  satirlar = satirlaraBol(fs.readFileSync(dosyaYolu));
}
function ttyGizli(soru) {
  return new Promise((resolve) => {
    process.stderr.write(soru);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const b = [];
    const veri = (c) => {
      for (const x of c) {
        if (x === 0x03) process.exit(130);
        if (x === 0x0d || x === 0x0a) {
          process.stdin.off('data', veri);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write('\n');
          const out = Buffer.from(b);
          b.fill(0);
          c.fill(0);
          resolve(out);
          return;
        }
        if (x === 0x7f || x === 0x08) b.pop();
        else b.push(x);
      }
      c.fill(0);
    };
    process.stdin.on('data', veri);
  });
}
async function parola(soru) {
  let ham;
  if (satirlar) ham = satirlar.shift();
  else if (process.stdin.isTTY) ham = await ttyGizli(soru);
  else {
    const p = [];
    for await (const c of process.stdin) p.push(c);
    satirlar = satirlaraBol(Buffer.concat(p));
    ham = satirlar.shift();
  }
  if (!ham || ham.length === 0) dur(`Parola bekleniyordu (bitti): ${soru.trim()}`, 2);
  const nfc = Buffer.from(ham.toString('utf8').normalize('NFC'), 'utf8');
  ham.fill(0);
  return nfc;
}
async function yeniParola(ad) {
  const a = await parola(`${ad} (en az 12 karakter): `);
  const b = await parola(`${ad} (tekrar): `);
  const ayni = a.length === b.length && crypto.timingSafeEqual(a, b);
  b.fill(0);
  if (!ayni) dur(`${ad}: iki giriş eşleşmedi`, 2);
  if ([...a.toString('utf8')].length < 12) dur(`${ad} en az 12 karakter olmalı`, 2);
  return a;
}
const gerek = (ad) => arg(ad) || dur(`--${ad}=… gerekli`, 2);

if (['kok-uret', 'yaprak-bas', 'yaprak-ac', 'yeniden-imzala'].includes(komut)) {
  try {
    if (komut === 'kok-uret') {
      const dizin = path.resolve(gerek('dizin'));
      const p = await yeniParola('OTA kökü parolası (satıcı KÖK parolasıyla aynı)');
      try {
        const k = await Z.otaKokUret({ dizin, kokParola: p });
        console.log(JSON.stringify({ v: 1, tur: 'ota-kok', sertifika: k.kokSertifika, parmakIzi: k.parmakIzi, bitis: k.bitis }));
      } finally {
        p.fill(0);
      }
    } else if (komut === 'yaprak-bas') {
      const gun = Number(arg('gun') ?? Z.OTA_YAPRAK_GUN);
      if (!Number.isInteger(gun) || gun < 1 || gun > Z.OTA_YAPRAK_GUN) dur(`--gun 1–${Z.OTA_YAPRAK_GUN} olmalı`, 2);
      const hedef = path.resolve(gerek('hedef'));
      const kp = await parola('OTA kökü parolası: ');
      const yp = await yeniParola('OTA yaprak parolası');
      try {
        if (kp.length === yp.length && crypto.timingSafeEqual(kp, yp)) dur('OTA yaprak parolası kök parolasıyla AYNI olamaz', 2);
        const y = await Z.otaYaprakBas({ kokAnahtar: path.resolve(gerek('kok-anahtar')), kokSertifika: path.resolve(gerek('kok')), hedef, kokParola: kp, yaprakParola: yp, yaprakCn: arg('cn') || 'TeksERP OTA Yaprak', yaprakGun: gun });
        console.log(JSON.stringify({ v: 1, tur: 'ota-yaprak', anahtar: y.anahtarYol, sertifika: y.yaprakYol, parmakIzi: y.parmakIzi, baslangic: y.baslangic, bitis: y.bitis }));
      } finally {
        kp.fill(0);
        yp.fill(0);
      }
    } else if (komut === 'yaprak-ac') {
      const anahtarYol = path.resolve(gerek('anahtar'));
      const yaprakYol = path.resolve(arg('yaprak') ?? path.join(path.dirname(anahtarYol), 'certificate.pem'));
      const p = await parola(`OTA yaprak parolası (${path.basename(path.dirname(anahtarYol))}): `);
      try {
        const o = Z.otaYaprakAc({ anahtarYol, yaprakYol, kokPem: fs.readFileSync(path.resolve(gerek('kok')), 'utf8'), parola: p });
        if (argv.includes('--json')) console.log(JSON.stringify({ v: 1, acildi: true, ...o }));
        else console.log(`✔ OTA yaprağı açıldı · SHA-256 ${o.parmakIzi} · ${o.baslangic.slice(0, 10)} → ${o.bitis.slice(0, 10)}`);
      } finally {
        p.fill(0);
      }
    } else {
      const { manifestYenidenImzala } = await import('./lib/ortak-ota.mjs');
      const cikti = path.resolve(gerek('cikti'));
      if (fs.existsSync(cikti)) dur(`${cikti} zaten var — üstüne yazılmaz`, 2);
      const anahtarYol = path.resolve(gerek('anahtar'));
      const yaprakPem = fs.readFileSync(path.resolve(arg('yaprak') ?? path.join(path.dirname(anahtarYol), 'certificate.pem')), 'utf8');
      const p = await parola('OTA yaprak parolası: ');
      let anahtar;
      try {
        anahtar = crypto.createPrivateKey({ key: fs.readFileSync(anahtarYol, 'utf8'), passphrase: p });
      } catch {
        dur('OTA yaprak anahtarı AÇILAMADI (parola yanlış ya da dosya bozuk)');
      } finally {
        p.fill(0);
      }
      const r = manifestYenidenImzala({ govde: fs.readFileSync(path.resolve(gerek('manifest'))), kokPem: fs.readFileSync(path.resolve(gerek('kok')), 'utf8'), anahtar, yaprakPem });
      fs.writeFileSync(cikti, r.govde, { flag: 'wx', mode: 0o644 });
      console.log(JSON.stringify({ v: 1, tur: 'ota-manifest', cikti, id: r.manifest.id, runtimeVersion: r.manifest.runtimeVersion, keyid: r.keyid }));
    }
  } catch (e) {
    dur(`${e.message}${e.satirlar?.length ? ` — ${e.satirlar.join(' ')}` : ''}`);
  }
  process.exit(0);
}

if (komut === 'profil') {
  process.stdout.write(Z.OPENSSL_PROFILI);
  process.exit(0);
}
if (komut !== 'denetle') {
  console.error('Kullanım: node scripts/ota-zinciri.mjs <profil|denetle|kok-uret|yaprak-bas|yaprak-ac|yeniden-imzala> (ayrıntı dosya başında)');
  process.exit(2);
}
const k = ortakKimlik();
const kokYol = path.resolve(MOBIL, arg('kok') ?? k.otaSertifika);
const yaprakYol = path.resolve(MOBIL, arg('yaprak') ?? k.otaYaprak);
const eksik = [kokYol, yaprakYol].filter((y) => !fs.existsSync(y));
if (eksik.length) {
  console.error(`ÖLÇÜLEMEDİ — sertifika yok: ${eksik.join(', ')}`);
  process.exit(2);
}
const kokPem = fs.readFileSync(kokYol, 'utf8');
const yaprakPem = fs.readFileSync(yaprakYol, 'utf8');
const h = [...Z.kokHatalari(kokPem), ...Z.yaprakHatalari(yaprakPem, kokPem, { esikGun: Z.OTA_YAPRAK_ESIK_GUN })];
for (const [ad, pem] of [['OTA kökü', kokPem], ['OTA yaprağı', yaprakPem]]) {
  let x;
  try {
    x = new X509Certificate(pem);
  } catch {
    continue;
  }
  console.log(`${ad.padEnd(12)}: ${x.subject.replace(/\n/g, ', ')} · ${x.validFrom} → ${x.validTo} · SHA-256 ${x.fingerprint256}`);
}
if (h.length) {
  for (const s of h) console.error(`  ✖ ${s}`);
  process.exit(1);
}
console.log('✔ OTA zinciri geçerli: kök CA (pathLen 0, EKU yok), yaprak CA değil + codeSigning + köke bağlı, süre ve 30 gün eşiği tamam.');
