// =============================================================================
// KORUMALI SUNUCU DERLEMESI — esbuild (bizim kod, minify + isim karartma) →
//                              bytenode (.jsc, V8 bayt kodu) — Faz 2b
// =============================================================================
// NE YAPAR (2a ölçümü LISANS-KOD-KORUMA.md / KOD-KORUMA-OLCUM.md):
//   1. src/server.ts'i TEK dosyaya paketler — YALNIZ BİZİM KOD (Prisma/.prisma/
//      client/bwip-js DIŞARIDA, build-araclar.mjs kalıbı; üçüncü taraf bayt koduna
//      çevrilmez, `toString` bozulur), minify + isim karartma (`licenseGate` gibi
//      adlar kaybolur), harita HARİCİ.
//   2. Derleme KİMLİĞİ (commit · zaman · node/V8 · platform/mimari · sha256) çıkarır.
//   3. bytenode ÖNCESİ .cjs + .cjs.map + kimliği REPO DIŞI arşive yazar (yığındaki
//      `:1:<sütun>`u kaynağa çeviren tek yer; PAKETE GİRMEZ).
//   4. bytenode ile `.jsc` üretir — AMA yalnız HOST hedefle uyuşuyorsa. Bayt kodu
//      OS/mimari/V8'e kilitli (2a: 24.18↔24.21 aynı V8 KABUL, 26.x RED) → Mac'te
//      win/linux .jsc ÜRETİLEMEZ; o hedef ERTELENİR (CI korumali-paket.yml ya da
//      thinkpad-1 üretir). Host uyuyorsa `.jsc` + `server-kunye.json` + yükleyici yazılır.
//
// YÜKLEYİCİ (dist/server.js): `.jsc`yi açmadan ÖNCE process.versions.v8 tabanını +
//   platform + mimariyi `server-kunye.json` ile kıyaslar; uymazsa V8'in çıplak
//   reddi yerine AÇIK TÜRKÇE hata (paket kendi runtime\node.exe'siyle koşmalı).
//   bytenode ÇALIŞMA ZAMANI bağımlılığıdır (paketin içinde; `--omit=dev` onu ELEMEZ).
//
// KULLANIM (Teks-Erp/ içinden, ağır iş sarmalayıcısıyla):
//   node ../scripts/agir-is.mjs -- node scripts/build-korumali.mjs [--hedef=win-x64|linux-x64] [--cikti=dist]
//   Ortam: KORUMA_ARSIV_DIZINI (varsayılan ~/.tekserp/kaynak-haritalari) — REPO DIŞI.
// =============================================================================

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hedefCoz, v8Taban as v8TabanCoz } from '../../scripts/lib/node-surumu.mjs';

const PROJ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(PROJ, '..');

// Çalışma anında node_modules'ten çözülecekler — 2a ve build-araclar.mjs ile AYNI küme.
const DISARIDA = ['@prisma/client', '.prisma/client', '.prisma/client/default', 'prisma', 'bwip-js'];

function arg(ad, varsayilan = null) {
  const p = process.argv.find((a) => a === `--${ad}` || a.startsWith(`--${ad}=`));
  if (!p) return varsayilan;
  return p.includes('=') ? p.slice(p.indexOf('=') + 1) : true;
}

/** Host'un ürettiği .jsc hangi hedefe ait — win-x64 · linux-x64; başka her şey null (üretilemez). */
function hostHedefi() {
  if (process.arch !== 'x64') return null; // arm64 (Mac) bayt kodu ne win ne linux hedefidir
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'linux') return 'linux-x64';
  return null;
}

function git(...a) {
  try {
    return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main() {
  const hedefAd = arg('hedef') || hostHedefi() || 'win-x64';
  const ciktiRel = arg('cikti') || 'dist';
  const ciktiDir = path.resolve(PROJ, ciktiRel); // mutlak yol da desteklenir
  const { surum: nodeSurum, v8Taban, hedef } = hedefCoz(hedefAd);
  const host = hostHedefi();
  const uretebilir = host !== null && host === hedefAd;

  console.log('== KORUMALI DERLEME ==');
  console.log(`  hedef      : ${hedefAd}  (node ${nodeSurum}, V8 tabanı ${v8Taban})`);
  console.log(`  host       : ${process.platform}/${process.arch} node ${process.version} (V8 ${process.versions.v8})`);
  console.log(`  .jsc üretim: ${uretebilir ? 'BU HOSTTA (host hedefe uyuyor)' : `ERTELENDİ (host ${host ?? process.platform + '/' + process.arch} ≠ hedef ${hedefAd}) — CI/thinkpad üretir`}`);

  fs.mkdirSync(ciktiDir, { recursive: true });

  // --- 1. esbuild: bizim kod, minify + isim karartma, harita harici -------------
  const { build } = await import('esbuild');
  const cjs = path.join(ciktiDir, 'server.cjs');
  const harita = `${cjs}.map`;
  const sonuc = await build({
    entryPoints: [path.join(PROJ, 'src/server.ts')],
    outfile: cjs,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: `node${nodeSurum.split('.')[0]}`,
    external: DISARIDA,
    minify: true,          // boşluk + ölü kod + İSİM KARARTMA
    sourcemap: 'external',  // .map AYRI dosya (arşive; pakete GİRMEZ)
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
  });
  const cjsBayt = fs.statSync(cjs).size;
  const cjsSha = crypto.createHash('sha256').update(fs.readFileSync(cjs)).digest('hex');
  console.log(`  esbuild    : server.cjs ${(cjsBayt / 1024).toFixed(0)} KB · uyarı ${sonuc.warnings.length} · sha256 ${cjsSha.slice(0, 12)}…`);

  // --- 2. Derleme kimliği -------------------------------------------------------
  const kunye = {
    urun: 'backend',
    hedef: hedefAd,
    nodeSurum,
    v8Taban,                          // yükleyicinin bekleyeceği taban (kayıttan)
    uretenNode: process.version,      // BU derlemeyi üreten host node
    uretenV8: process.versions.v8,
    uretenV8Taban: v8TabanCoz(process.versions.v8),
    platform: hedef.arsivKok.includes('win') ? 'win32' : 'linux',
    arch: 'x64',
    commit: git('rev-parse', 'HEAD'),
    kisaCommit: git('rev-parse', '--short', 'HEAD'),
    dal: git('rev-parse', '--abbrev-ref', 'HEAD'),
    zaman: new Date().toISOString(),
    cjsBayt,
    cjsSha256: cjsSha,
    jscUretildi: false,
  };

  // --- 3. Arşiv (REPO DIŞI): bytenode öncesi .cjs + .map + kimlik ----------------
  const arsivKok = process.env.KORUMA_ARSIV_DIZINI || path.join(os.homedir(), '.tekserp', 'kaynak-haritalari');
  const derlemeAd = `backend-${nodeSurum}-${hedefAd}-${kunye.kisaCommit || 'nogit'}-${kunye.zaman.replace(/[:.]/g, '').slice(0, 15)}`;
  const arsivDir = path.join(arsivKok, derlemeAd);
  fs.mkdirSync(arsivDir, { recursive: true });
  fs.copyFileSync(cjs, path.join(arsivDir, 'server.cjs'));
  if (fs.existsSync(harita)) fs.copyFileSync(harita, path.join(arsivDir, 'server.cjs.map'));
  fs.writeFileSync(path.join(arsivDir, 'kunye.json'), JSON.stringify(kunye, null, 2) + '\n');
  if (arsivDir.startsWith(REPO + path.sep)) {
    throw new Error(`KAYNAK HARİTASI ARŞİVİ REPO İÇİNDE (${arsivDir}) — KORUMA_ARSIV_DIZINI'ni repo dışına ver. Harita pakete/repoya GİRMEZ.`);
  }
  console.log(`  arşiv      : ${arsivDir}  (server.cjs + .map + kunye.json — REPO DIŞI, pakete girmez)`);

  // Harici harita .cjs'in yanında kalırsa pakete sızabilir → çıktı dizininden SİL (arşivde kopyası var).
  if (fs.existsSync(harita)) fs.rmSync(harita);

  // --- 4. .jsc (bytenode) — yalnız host hedefe uyuyorsa -------------------------
  const jsc = path.join(ciktiDir, 'server.jsc');
  const bekliyorIz = path.join(ciktiDir, 'server.jsc.BEKLIYOR');
  fs.rmSync(jsc, { force: true });
  fs.rmSync(bekliyorIz, { force: true });

  if (uretebilir) {
    const bytenode = (await import('bytenode')).default ?? (await import('bytenode'));
    await bytenode.compileFile({ filename: cjs, output: jsc });
    if (!fs.existsSync(jsc) || fs.statSync(jsc).size === 0) throw new Error('bytenode .jsc üretemedi');
    kunye.jscUretildi = true;
    kunye.jscBayt = fs.statSync(jsc).size;
    kunye.jscSha256 = crypto.createHash('sha256').update(fs.readFileSync(jsc)).digest('hex');
    // Yükleyici kimliği: ÜRETEN host'un gerçek V8'i (kayıt tabanına uyması yükleyicide de ölçülür).
    kunye.v8Taban = kunye.uretenV8Taban;
    kunye.platform = process.platform;
    kunye.arch = process.arch;
    console.log(`  bytenode   : server.jsc ${(kunye.jscBayt / 1024).toFixed(0)} KB · V8 ${process.versions.v8}`);
    // bytenode öncesi .cjs PAKETE GİRMEZ (kaynak; arşivde kopyası var).
    fs.rmSync(cjs, { force: true });
  } else {
    // ERTELE: host bu hedefin .jsc'sini üretemez. Marker + kimlik bırak; CI/thinkpad tamamlar.
    fs.writeFileSync(bekliyorIz, [
      `# ${hedefAd} .jsc BU HOSTTA ÜRETİLEMEDİ (${process.platform}/${process.arch}).`,
      '# Bayt kodu OS/mimari/V8\'e kilitlidir. Hedef platformda üret:',
      `#   .github/workflows/korumali-paket.yml (${hedefAd === 'win-x64' ? 'windows-latest' : 'ubuntu-latest'})`,
      `#   ya da thinkpad-1'de paketin node ${nodeSurum} ikilisiyle:  node scripts/build-korumali.mjs --hedef=${hedefAd}`,
      `# Arşiv (kaynak harita): ${arsivDir}`,
    ].join('\n') + '\n');
    console.log(`  ERTELE     : ${path.relative(PROJ, bekliyorIz)} bırakıldı — .jsc'yi hedef platform üretir; server.cjs çıktıda kaldı (CI bytenode'la .jsc'ye çevirir)`);
  }

  // --- 5. Yükleyici dist/server.js ---------------------------------------------
  fs.writeFileSync(path.join(ciktiDir, 'server-kunye.json'), JSON.stringify(kunye, null, 2) + '\n');
  fs.writeFileSync(path.join(ciktiDir, 'server.js'), yukleyiciKaynak());
  console.log(`  yükleyici  : dist/server.js (bytenode; V8/platform/mimari kapısı) + server-kunye.json`);
  console.log('== bitti ==');
}

/** Pakete giden yükleyici — .jsc'yi açmadan önce V8/platform/mimari uyumunu ölçer. */
function yukleyiciKaynak() {
  return `"use strict";
// =============================================================================
// KORUMALI PAKET YÜKLEYİCİSİ (Faz 2b) — build-korumali.mjs üretir, ELLE DÜZENLENMEZ
// =============================================================================
// dist/server.jsc = V8 bayt kodu; V8 sürümüne + platforma + mimariye kilitli.
// Paket kendi runtime\\node.exe'siyle koşar (ecosystem.config.js interpreter).
// Bu yükleyici, V8'in çıplak "cachedDataRejected" reddi yerine, açmadan ÖNCE
// AÇIK TÜRKÇE hata verir: paketin hangi Node'la koşması gerektiğini söyler.
const fs = require("fs");
const path = require("path");
function taban(v8) { var m = /^(\\d+\\.\\d+\\.\\d+\\.\\d+)/.exec(String(v8 || "")); return m ? m[1] : null; }
var kunye;
try {
  kunye = JSON.parse(fs.readFileSync(path.join(__dirname, "server-kunye.json"), "utf8"));
} catch (e) {
  console.error("KORUMALI PAKET: server-kunye.json okunamadı — paket bozuk.", e && e.message);
  process.exit(78);
}
var v8 = taban(process.versions.v8);
if (process.platform !== kunye.platform || process.arch !== kunye.arch || v8 !== kunye.v8Taban) {
  console.error(
    "KORUMALI PAKET bu Node ile AÇILAMAZ.\\n" +
    "  bu Node : " + process.platform + "/" + process.arch + " V8 " + v8 + " (" + process.version + ")\\n" +
    "  paket   : " + kunye.platform + "/" + kunye.arch + " V8 " + kunye.v8Taban + " (node " + kunye.nodeSurum + ")\\n" +
    "  Çözüm   : paket kendi runtime Node'uyla koşmalı (ecosystem.config.js interpreter). Sistem Node'u bayt kodunu açamaz."
  );
  process.exit(78);
}
require("bytenode");
require(path.join(__dirname, "server.jsc"));
`;
}

main().catch((e) => {
  console.error('\\n  ✖ KORUMALI DERLEME BAŞARISIZ:', e && e.stack ? e.stack : e);
  process.exit(1);
});
