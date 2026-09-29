#!/usr/bin/env node
// =============================================================================
// KORUMALI PAKET ÇALIŞMA ZAMANI — Node ikilisini indir + SHA256 doğrula + çıkar
// =============================================================================
// Korumalı paket kendi `runtime\node.exe` (win) / `runtime/bin/node` (linux)
// ikilisini TAŞIR; sürüm/adres/SHA256 TEK kaynak `deploy/node-surumu.json`.
// Bu betik o kaydı okur, resmî arşivi indirir, SHA256'sını DOĞRULAR (tutmazsa
// DURUR) ve arşivden yalnız node ikilisini çıkarıp paket sahnesine kopyalar.
//
// TEK İNDİRME UYGULAMASI: hem CI (korumali-paket.yml) hem paketle.ps1 bunu
// çağırır — kabuk/PS ikinci bir indirici yazmaz (feed.cjs kalıbı: veri tek
// kaynak, çağıran platforma göre değişir).
//
//   node scripts/koruma-runtime-indir.mjs <win-x64|linux-x64> <sahne-dizini>
//     → <sahne-dizini>/runtime/node.exe   (win-x64)
//     → <sahne-dizini>/runtime/bin/node   (linux-x64)
//
// ÇIKIŞ: 0 tamam · 1 doğrulama/indirme hatası · 2 kayıt/argüman hatası (ÖLÇÜLEMEDİ).
// Çıkarıcı: `tar` (bsdtar Windows/macOS'ta zip'i de açar; Linux tar.xz'yi GNU tar açar).
// =============================================================================

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { HEDEFLER, Olculemedi, hedefCoz } from './lib/node-surumu.mjs';

function dur(kod, msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(kod);
}

async function main() {
  const [hedefAd, sahne] = process.argv.slice(2);
  if (!hedefAd || !sahne) dur(2, `Kullanım: node scripts/koruma-runtime-indir.mjs <${HEDEFLER.join('|')}> <sahne-dizini>`);

  let coz;
  try {
    coz = hedefCoz(hedefAd);
  } catch (e) {
    if (e instanceof Olculemedi) dur(2, `ÖLÇÜLEMEDİ — ${e.message}`);
    dur(2, `${e.message}${e.satirlar ? '\n    ' + e.satirlar.join('\n    ') : ''}`);
  }
  const { surum, hedef } = coz;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tekserp-runtime-'));
  const arsivYol = path.join(tmp, hedef.dosya);
  console.log(`== KORUMALI RUNTIME ==`);
  console.log(`  hedef : ${hedefAd}  node ${surum}`);
  console.log(`  indir : ${hedef.url}`);

  // --- indir --------------------------------------------------------------
  let arrayBuf;
  try {
    const yanit = await fetch(hedef.url, { redirect: 'follow' });
    if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
    arrayBuf = await yanit.arrayBuffer();
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    dur(1, `indirilemedi: ${e.message}`);
  }
  const buf = Buffer.from(arrayBuf);
  fs.writeFileSync(arsivYol, buf);

  // --- SHA256 doğrula (tutmazsa DUR) --------------------------------------
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== hedef.sha256) {
    fs.rmSync(tmp, { recursive: true, force: true });
    dur(1, `SHA256 UYUŞMUYOR — beklenen ${hedef.sha256.slice(0, 16)}… indirilen ${sha.slice(0, 16)}…\n    Resmî kaynak zehirlenmiş ya da dosya bozuk. Paket ÜRETİLMEZ.`);
  }
  console.log(`  sha256: ${sha.slice(0, 16)}… ✓ (resmî kayıtla eşit)`);

  // --- çıkar (yalnız node ikilisi) ----------------------------------------
  const icYol = `${hedef.arsivKok}/${hedef.runtimeAlt}`; // ör. node-v24.18.0-win-x64/node.exe
  const cikarTmp = path.join(tmp, 'ac');
  fs.mkdirSync(cikarTmp, { recursive: true });
  const tarArgs = hedef.dosya.endsWith('.tar.xz')
    ? ['-xJf', arsivYol, '-C', cikarTmp, icYol]
    : ['-xf', arsivYol, '-C', cikarTmp, icYol]; // .zip → bsdtar (Windows/macOS)
  try {
    execFileSync('tar', tarArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    dur(1, `arşivden çıkarılamadı (${icYol}): ${String(e.stderr ?? e.message).trim().slice(0, 200)}`);
  }
  const cikan = path.join(cikarTmp, icYol);
  if (!fs.existsSync(cikan) || fs.statSync(cikan).size === 0) {
    fs.rmSync(tmp, { recursive: true, force: true });
    dur(1, `node ikilisi çıkmadı: ${icYol}`);
  }

  // --- sahneye kopyala (runtime/<runtimeAlt>) -----------------------------
  const hedefYol = path.join(sahne, 'runtime', hedef.runtimeAlt);
  fs.mkdirSync(path.dirname(hedefYol), { recursive: true });
  fs.copyFileSync(cikan, hedefYol);
  if (hedef.runtimeAlt.endsWith('/node') || hedef.runtimeAlt === 'bin/node') {
    fs.chmodSync(hedefYol, 0o755); // linux node yürütülebilir olmalı
  }
  const boyut = (fs.statSync(hedefYol).size / 1024 / 1024).toFixed(1);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`  çıkar : ${path.join('runtime', hedef.runtimeAlt)} (${boyut} MB) — paket bununla koşar`);
  console.log(`== bitti ==`);
}

main().catch((e) => {
  console.error(`\n  ✖ RUNTIME İNDİRME BAŞARISIZ: ${e && e.stack ? e.stack : e}`);
  process.exit(1);
});
