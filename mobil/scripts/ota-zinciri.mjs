#!/usr/bin/env node
/**
 * TeksERP Tablet — OTA sertifika zinciri aracı (K-2 / I5). Tören bu araçla ölçer; anahtar ÜRETMEZ.
 *
 *   node scripts/ota-zinciri.mjs profil                                  # openssl uzantı profili (stdout)
 *   node scripts/ota-zinciri.mjs denetle [--kok=<pem>] [--yaprak=<pem>]   # kök CA + EKU'suz, yaprak CA değil + codeSigning + köke bağlı
 *
 * Varsayılan yollar ortak kimlikten (`deploy/dagitim.json` → `ortak-kimlik.cjs`). Çıkış: 0 yeşil · 1 kırmızı · 2 ÖLÇÜLEMEDİ.
 * Kural ve gerekçe: docs/design/ISTEMCI-ANAHTARI-KOK-ALTINDA.md §3.1, §3.5, §6 adım 3.
 */
import { X509Certificate } from 'node:crypto';
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

if (komut === 'profil') {
  process.stdout.write(Z.OPENSSL_PROFILI);
  process.exit(0);
}
if (komut !== 'denetle') {
  console.error('Kullanım: node scripts/ota-zinciri.mjs <profil|denetle> [--kok=<pem>] [--yaprak=<pem>]');
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
