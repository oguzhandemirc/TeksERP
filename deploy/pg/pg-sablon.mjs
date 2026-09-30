#!/usr/bin/env node
// =============================================================================
// KENDİ PostgreSQL ÖRNEĞİ — tekserp.conf + pg_hba.conf üret / kurulu dosyayı denetle
// =============================================================================
// Şablon ve bellek formülü TEK KAYNAK (deploy/pg/*.sablon + pg-ornegi.json). Üretilen
// dosya yazılmadan ÖNCE yasaklara karşı denetlenir (yalnız 127.0.0.1 · yalnız SCRAM ·
// trust yok · UTC); ihlalde dosya YAZILMAZ.
//
//   node deploy/pg/pg-sablon.mjs --ram-mb <MB> --port <N> [--cikti <dizin>]
//        --cikti yoksa iki dosya ayraçla stdout'a basılır
//   node deploy/pg/pg-sablon.mjs --denetle <tekserp.conf> <pg_hba.conf>
//        kurulu (üretilmiş) dosyaları aynı yasaklara karşı denetler
//
// ÇIKIŞ: 0 temiz · 1 yasak ihlali · 2 ÖLÇÜLEMEDİ (okuma/argüman).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ORNEK_REL, Olculemedi, confYasaklari, hbaYasaklari, jsonOku, metinOku, ornekHatalari, yapilandirmaUret } from './lib/pg-ornegi.mjs';

function arg(ad) {
  const i = process.argv.indexOf(ad);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function dur(kod, msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(kod);
}

function yasakBas(hatalar) {
  for (const x of hatalar) console.error(`  ✖ ${x}`);
  dur(1, `${hatalar.length} yasak ihlali — dosya YAZILMADI / kabul edilmez.`);
}

function denetle(confYol, hbaYol) {
  let conf;
  let hba;
  try {
    conf = fs.readFileSync(confYol, 'utf8');
    hba = fs.readFileSync(hbaYol, 'utf8');
  } catch (e) {
    dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
  }
  const h = [...confYasaklari(conf, { sablon: false }), ...hbaYasaklari(hba)];
  if (h.length) yasakBas(h);
  console.log(`✅ ${confYol} + ${hbaYol}: yalnız 127.0.0.1 · yalnız scram-sha-256 · trust yok · UTC`);
}

function uret() {
  const ramMB = Number(arg('--ram-mb'));
  const port = Number(arg('--port'));
  if (!Number.isInteger(ramMB) || !Number.isInteger(port)) dur(2, 'Kullanım: --ram-mb <MB> --port <N> [--cikti <dizin>]  |  --denetle <tekserp.conf> <pg_hba.conf>');
  let ornek;
  let confSablon;
  let hbaSablon;
  try {
    ornek = jsonOku(ORNEK_REL);
    const oh = ornekHatalari(ornek);
    if (oh.length) dur(2, `SÖZLEŞME KIRMIZI (${ORNEK_REL}):\n    ${oh.join('\n    ')}`);
    confSablon = metinOku(ornek.yapilandirma.confSablonu);
    hbaSablon = metinOku(ornek.yapilandirma.hbaSablonu);
  } catch (e) {
    dur(2, e instanceof Olculemedi ? `ÖLÇÜLEMEDİ — ${e.message}` : e.message);
  }
  let cikti;
  try {
    cikti = yapilandirmaUret({ ramMB, port }, { ornek, confSablon, hbaSablon });
  } catch (e) {
    dur(2, e.message);
  }
  const h = [...confYasaklari(cikti.conf, { sablon: false }), ...hbaYasaklari(cikti.hba)];
  if (h.length) yasakBas(h);

  const dizin = arg('--cikti');
  if (!dizin) {
    process.stdout.write(`# ---- ${ornek.yapilandirma.includeDosyasi} ----\n${cikti.conf}# ---- pg_hba.conf ----\n${cikti.hba}`);
    return;
  }
  fs.mkdirSync(dizin, { recursive: true });
  fs.writeFileSync(path.join(dizin, ornek.yapilandirma.includeDosyasi), cikti.conf);
  fs.writeFileSync(path.join(dizin, 'pg_hba.conf'), cikti.hba);
  const d = cikti.degerler;
  console.log(`✅ ${dizin}: ${ornek.yapilandirma.includeDosyasi} (port ${d.PORT} · shared_buffers ${d.SHARED_BUFFERS} · effective_cache_size ${d.EFFECTIVE_CACHE_SIZE} · maintenance_work_mem ${d.MAINTENANCE_WORK_MEM}) + pg_hba.conf`);
  console.log(`   postgresql.conf sonuna: ${ornek.yapilandirma.includeSatiri}`);
}

const i = process.argv.indexOf('--denetle');
if (i > 0) {
  const [confYol, hbaYol] = process.argv.slice(i + 1, i + 3);
  if (!confYol || !hbaYol) dur(2, 'Kullanım: --denetle <tekserp.conf> <pg_hba.conf>');
  denetle(confYol, hbaYol);
} else {
  uret();
}
