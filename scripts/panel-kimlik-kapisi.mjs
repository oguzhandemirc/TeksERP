#!/usr/bin/env node
// =============================================================================
// PANEL ORTAK KİMLİK KAPISI (tek ortak paket O5) — `deploy/electron-paketle.sh` argümansız kipinin adımları
// =============================================================================
//   node scripts/panel-kimlik-kapisi.mjs dinlenme        # ağaç ortak kimlikte dinlenmede mi (derlemeden ÖNCE)
//   node scripts/panel-kimlik-kapisi.mjs derleme         # electron-builder `-c.*` kimlik argümanları (satır başına bir)
//   node scripts/panel-kimlik-kapisi.mjs feed            # gömülecek güncelleme adresi (dinlenme grubu)
//   node scripts/panel-kimlik-kapisi.mjs paket <dizin>   # derlenen paket (release/ortak/<sürüm>) ortak kimlikte mi
//   node scripts/panel-kimlik-kapisi.mjs kunye <dizin> <sürüm> <commit>  # derleme künyesi (derleme.json; kanal: null = ortak)
//   node scripts/panel-kimlik-kapisi.mjs taban-yaz       # package.json tabanını dağıtım kaydından yaz (kimlik değişince)
// Çıkış: 0 geçti · 1 kırmızı · 2 ÖLÇÜLEMEDİ (o da durdurur). Ağ yok; kayıtlara yazmaz.
// =============================================================================

import path from 'node:path';

import { KAYIT_REL, ESKI_KAYIT_REL, Olculemedi, dosyalariOku } from './lib/dagitim.mjs';
import { PANEL_KUNYE_ADI, derlemeKunyesiYaz } from './lib/derleme-bagi.mjs';
import { Olculemedi as KanalOlculemedi, panelArtefaktKimligi, panelKaynakFarki } from './lib/kanallar.mjs';
import {
  PANEL_DINLENME_DOSYALARI, ortakKimlik, panelDinlenmeFarki, panelOrtakArtefaktFarki, panelOrtakDerlemeArgumanlari, panelTabaniniYaz,
} from './lib/panel-kimlik.mjs';

function dur(baslik, satirlar, kod) {
  console.error(`\n  ✖ ${baslik}`);
  for (const s of satirlar) console.error(`    ${s}`);
  console.error('');
  process.exit(kod);
}

function eskiKayit(d) {
  try {
    return JSON.parse(d[ESKI_KAYIT_REL]);
  } catch {
    throw new Olculemedi(`${ESKI_KAYIT_REL} okunamadı/ayrıştırılamadı`);
  }
}

function main([komut, dizin, surum, commit]) {
  const d = dosyalariOku(PANEL_DINLENME_DOSYALARI);
  if (komut === 'dinlenme') {
    // Ortak taban + eski kanal kimliği literali yok (kaynak kimliği @shared/channel'dan alır).
    const f = [...panelDinlenmeFarki(d), ...panelKaynakFarki(eskiKayit(d), dosyalariOku([
      'Electron/electron/main.ts', 'Electron/index.html', 'Electron/resources/splash.html', 'Electron/shared/channel.ts', 'Electron/build-identity.ts',
    ]))];
    if (f.length) {
      dur('AĞAÇ ORTAK PAKET İÇİN PAKETLENEMEZ — dinlenme tabanı ortak kimlik değil ya da kaynak kimlik literali taşıyor', [
        ...f,
        `Kimlik kayıtta değiştiyse: node scripts/panel-kimlik-kapisi.mjs taban-yaz (kaynak ${KAYIT_REL}).`,
      ], 1);
    }
    const k = ortakKimlik(d);
    return void console.log(`  ✓ ağaç dinlenmede · ortak kimlik ${k.appId} "${k.urunAdi}" · dinlenme grubu ${k.grup}`);
  }
  if (komut === 'derleme') {
    for (const a of panelOrtakDerlemeArgumanlari(ortakKimlik(d))) console.log(a);
    return;
  }
  if (komut === 'feed') return void console.log(ortakKimlik(d).feed);
  if (komut === 'paket') {
    if (!dizin) dur('paket: derlenen paket dizini verilmedi', [], 2);
    const f = panelOrtakArtefaktFarki(ortakKimlik(d), eskiKayit(d), panelArtefaktKimligi(dizin));
    if (f.length) dur('DERLENEN PAKET ORTAK KİMLİKTE DEĞİL — yayınlama', f, 1);
    return void console.log(`  ✓ paket ortak kimlikte (appId · ürün adı · app-update.yml · ana süreç · arayüz) ve eski kanal kimliği taşımıyor`);
  }
  if (komut === 'kunye') {
    if (!dizin || !surum || !commit) dur('kunye: <dizin> <sürüm> <commit> gerekli', [], 2);
    // Ortak paket gruba bağlı değildir (grup çalışma anında kiradan, O6): künyenin kanalı null.
    const k = derlemeKunyesiYaz(path.join(dizin, PANEL_KUNYE_ADI), {
      urun: 'panel', kanal: null, surum, commit, dosyaYolu: path.join(dizin, `TeksERP-${surum}-Setup.exe`), ek: { kimlik: 'ortak' },
    });
    return void console.log(`  ✓ derleme künyesi: ${PANEL_KUNYE_ADI} · commit ${k.commit.slice(0, 12)} · ${k.dosya}`);
  }
  if (komut === 'taban-yaz') {
    const k = panelTabaniniYaz();
    return void console.log(`  ✓ Electron/package.json tabanı yazıldı: ${k.appId} "${k.urunAdi}" · ${k.feed}`);
  }
  dur(`bilinmeyen komut: ${komut ?? '(yok)'}`, ['dinlenme · derleme · feed · paket <dizin> · kunye <dizin> <sürüm> <commit> · taban-yaz'], 2);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  if (e instanceof Olculemedi || e instanceof KanalOlculemedi) dur(`ÖLÇÜLEMEDİ — ${e.message}`, ['Ölçülemeyen kapı geçmiş kapı değildir: DUR.'], 2);
  dur(`beklenmeyen hata: ${e?.stack ?? e}`, [], 2);
}
