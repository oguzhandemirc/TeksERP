#!/usr/bin/env node
// =============================================================================
// PAROLA KAYDET — tören/imza parolasını macOS Anahtar Zinciri'ne yazar (kullanıcı kendi Terminal'inde koşar)
// =============================================================================
//   node scripts/parola-kaydet.mjs <ad>       parolayı gizli girdiyle İKİ kez sorar, `tekserp/<ad>` olarak kaydeder
//                                             (varsa eskisini siler, yeniden yazar); yazdıktan sonra geri okuyup doğrular
//   node scripts/parola-kaydet.mjs --liste    hangi adların kayıtlı olduğunu gösterir (DEĞER GÖSTERMEZ)
// Adlar ve hangi aracın kullandığı: scripts/lib/parola-kasasi.mjs (KASA_KATALOGU). Parola argümandan ve ortamdan
// ALINMAZ; terminal yoksa kayıt yapılmaz (yalnız bekçinin sahte kasasında stdin satırları). Değer hiçbir çıktıya basılmaz.
// Başta/sonda boşluk (NBSP dahil) atılır ve bildirilir — kopyala-yapıştırla gelen sondaki boşluk anahtarı açtırmaz; içteki
// boşluk korunur.
// Çıkış: 0 tamam · 1 hata · 2 kullanım.
// =============================================================================

import crypto from 'node:crypto';
import process from 'node:process';
import { KASA_ADLARI, KASA_KATALOGU, KASA_ORTAM, KasaHatasi, kasaHizmeti, kasaKayitliMi, kasaKomutu, kasayaYaz } from './lib/parola-kasasi.mjs';

const dur = (mesaj, kod = 1) => {
  process.stderr.write(`✖ ${mesaj}\n`);
  process.exit(kod);
};

const argv = process.argv.slice(2);
if (argv.some((a) => /^--[^=]*(parola|password|sifre|secret)/i.test(a))) dur('Parola argümandan ALINMAZ — terminalde gizli sorulur', 2);
const kullanim = `Kullanım: node scripts/parola-kaydet.mjs <${KASA_ADLARI.join('|')}>  ·  node scripts/parola-kaydet.mjs --liste`;

let komut;
try {
  komut = kasaKomutu();
} catch (e) {
  dur(e.message, 2);
}
if (!komut) dur(`Parola kasası kapalı (${KASA_ORTAM}=kapali ya da macOS dışı) — kayıt yalnız Mac'te yapılır`, 2);
const sahte = (process.env[KASA_ORTAM] ?? '').startsWith('sahte:');

if (argv.length === 1 && argv[0] === '--liste') {
  for (const ad of KASA_ADLARI) {
    let durum;
    try {
      durum = kasaKayitliMi(ad) ? '✓ kayıtlı' : '— yok    ';
    } catch (e) {
      durum = '? okunamadı';
      process.stderr.write(`  ${e.message}\n`);
    }
    process.stdout.write(`${durum}  ${kasaHizmeti(ad).padEnd(22)} ${KASA_KATALOGU[ad].ad} — ${KASA_KATALOGU[ad].kullanan}\n`);
  }
  process.exit(0);
}
if (argv.length !== 1 || argv[0].startsWith('-') || !KASA_ADLARI.includes(argv[0])) dur(kullanim, 2);
const ad = argv[0];
const tanim = KASA_KATALOGU[ad];

// ---------------------------------------------------------------- gizli girdi
let stdinSatirlari = null;
let kenarAtildi = false;
async function stdinOku() {
  const parcalar = [];
  for await (const p of process.stdin) parcalar.push(p);
  const hepsi = Buffer.concat(parcalar);
  for (const p of parcalar) p.fill(0);
  const satirlar = [];
  let bas = 0;
  for (let i = 0; i <= hepsi.length; i++) {
    if (i === hepsi.length || hepsi[i] === 0x0a) {
      let son = i;
      if (son > bas && hepsi[son - 1] === 0x0d) son--;
      if (son > bas || i < hepsi.length) satirlar.push(Buffer.from(hepsi.subarray(bas, son)));
      bas = i + 1;
    }
  }
  hepsi.fill(0);
  return satirlar;
}

function ttyGizliOku(soru) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    process.stderr.write(soru);
    const baytlar = [];
    const onData = (parca) => {
      for (const b of parca) {
        if (b === 0x03) {
          stdin.setRawMode(false);
          baytlar.fill(0);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (b === 0x0d || b === 0x0a) {
          stdin.off('data', onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stderr.write('\n');
          const cikti = Buffer.from(baytlar);
          baytlar.fill(0);
          parca.fill(0);
          resolve(cikti);
          return;
        }
        if (b === 0x7f || b === 0x08) baytlar.pop();
        else baytlar.push(b);
      }
      parca.fill(0);
    };
    stdin.on('data', onData);
  });
}

async function sor(soru) {
  let ham;
  if (process.stdin.isTTY) ham = await ttyGizliOku(soru);
  else if (sahte) {
    stdinSatirlari ??= await stdinOku();
    ham = stdinSatirlari.shift();
    if (!ham) dur('Parola bekleniyordu (stdin bitti)', 2);
  } else dur("Terminal yok — parola kaydı yalnız kendi Terminal'inde, gizli girdiyle yapılır", 2);
  const metin = ham.toString('utf8').normalize('NFC');
  ham.fill(0);
  const kirpik = metin.replace(/^\s+|\s+$/gu, '');
  if (kirpik.length !== metin.length) kenarAtildi = true;
  return Buffer.from(kirpik, 'utf8');
}

process.stdout.write(`${kasaHizmeti(ad)} — ${tanim.ad}\nKullanan: ${tanim.kullanan}\n`);
const ilk = await sor(`Parola (en az ${tanim.min} karakter; görünmez): `);
const ikinci = await sor('Parola (tekrar): ');
const ayni = ilk.length === ikinci.length && crypto.timingSafeEqual(ilk, ikinci);
ikinci.fill(0);
if (kenarAtildi) process.stderr.write('⚠ Kenar boşluğu atıldı: girilen değerin başındaki/sonundaki boşluk kaydedilmeyecek (içteki boşluklar korunur; değer gösterilmez).\n');
if (!ayni) {
  ilk.fill(0);
  dur('İki giriş eşleşmedi — kayıt yapılmadı', 2);
}
if ([...ilk.toString('utf8')].length < tanim.min) {
  ilk.fill(0);
  dur(`En az ${tanim.min} karakter olmalı — kayıt yapılmadı`, 2);
}
let sonuc;
try {
  sonuc = kasayaYaz(ad, ilk);
} catch (e) {
  dur(e instanceof KasaHatasi ? e.message : 'Anahtar Zinciri yazımı başarısız');
} finally {
  ilk.fill(0);
}
const eski = sonuc.eskiSilindi ? ' (eski kayıt silinip yeniden yazıldı)' : '';
process.stdout.write(`✓ ${kasaHizmeti(ad)} Anahtar Zinciri'ne kaydedildi${eski} ve geri okunarak doğrulandı (değer gösterilmez).\n`);
