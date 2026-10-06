#!/usr/bin/env node
// =============================================================================
// DAĞITIM KAPISI — kabuk paketleyiciler için CLI (yüklemler scripts/lib/dagitim.mjs; kayıt deploy/dagitim.json)
// =============================================================================
// Çıkış: 0 geçti · 1 KIRMIZI · 2 ÖLÇÜLEMEDİ — sıfır-dışı her çıkış DURDURUR.
//
//   node scripts/dagitim-kapisi.mjs backend-paketle   # ortak backend paketinin kimliği → KEY=VALUE (argümansız; müşteri/kanal YOK)
//
// Eski kanal yolu (`paketle.ps1 -Musteri <kod>` → `scripts/kanal-kapisi.mjs backend-paketle`) ayrıdır ve
// bu dosyadan hiçbir şey okumaz; o yol O15'te kalkar.
// =============================================================================

import { KANAL_ADLARI_REL, KAYIT_REL, Olculemedi, VENDOR_URL_REL, backendPaketKimligi, dosyalariOku, kayitAyristir } from './lib/dagitim.mjs';

function dur(baslik, kod) {
  console.error(`  ✖ ${baslik}`);
  process.exit(kod);
}

function main(argv) {
  const [komut, ...fazla] = argv;
  if (komut !== 'backend-paketle') dur(`bilinmeyen komut: ${komut ?? '(yok)'} — backend-paketle`, 2);
  if (fazla.length) dur(`backend-paketle argüman almaz (ortak paket müşteri/kanal kodu taşımaz): ${fazla.join(' ')}`, 2);
  const d = dosyalariOku([KAYIT_REL, VENDOR_URL_REL, KANAL_ADLARI_REL]);
  try {
    const ayar = backendPaketKimligi(kayitAyristir(d[KAYIT_REL]), d[VENDOR_URL_REL], d[KANAL_ADLARI_REL]);
    for (const [k, v] of Object.entries(ayar)) console.log(`${k}=${v}`);
  } catch (e) {
    dur(`backend-paketle: ${e.message}`, e instanceof Olculemedi ? 2 : 1);
  }
}

main(process.argv.slice(2));
