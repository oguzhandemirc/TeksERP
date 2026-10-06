#!/usr/bin/env node
// =============================================================================
// PAKETİN ÇAPA KİPİ TUTARLILIĞI (G3) — `deploy/paketle.ps1 -Korumali` çağırır, paketin KENDİ Node'uyla:
//   node scripts/native-capa-kipi.mjs <native .node> <dist/server-kunye.json>
// Bayt kodunun kipi (build-korumali künyesi `guvenCapasi`, kanaldan) ile native'in gömülü çapa kipi (künye
// `capaKipi`) AYNI olmalı ve native test çapasız olmalı; uyuşmazsa paket açılışta çekirdeksiz kalır
// (`CAPA_UYUSMAZ`) — kurulumda değil BURADA durulur.
// Çıkış: 0 tutarlı · 1 uyuşmaz / test derlemesi · 2 ÖLÇÜLEMEDİ (dosya yok, yüklenemedi, künye kipsiz).
// =============================================================================
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [nativeYol, kunyeYol] = process.argv.slice(2);
const KIPLER = ['uretim']; // tek kip; eski `hazirlik` künyesi tanınmaz → ÖLÇÜLEMEDİ (paket durur)

function olculemedi(neden) {
  console.error(`  ✖ çapa kipi ÖLÇÜLEMEDİ: ${neden}`);
  process.exit(2);
}

if (!nativeYol || !kunyeYol) olculemedi('kullanım: native-capa-kipi.mjs <native .node> <dist/server-kunye.json>');
if (!existsSync(nativeYol)) olculemedi(`native yok: ${nativeYol}`);
let paketKipi;
try {
  paketKipi = JSON.parse(readFileSync(kunyeYol, 'utf8')).guvenCapasi;
} catch (e) {
  olculemedi(`künye okunamadı (${kunyeYol}): ${e.message}`);
}
if (!KIPLER.includes(paketKipi)) olculemedi(`künye çapa kipi taşımıyor ya da tanınmıyor (${paketKipi}) — build-korumali.mjs G3 öncesi mi?`);

let kunye;
try {
  const m = { exports: {} };
  process.dlopen(m, path.resolve(nativeYol));
  kunye = JSON.parse(m.exports.kunye());
} catch (e) {
  olculemedi(`native yüklenemedi (${path.basename(nativeYol)}): ${e.message}`);
}

const sorunlar = [];
if (kunye.capaKipi !== paketKipi) sorunlar.push(`native ${kunye.capaKipi ?? 'kipsiz (eski ABI)'} çapalı, paket ${paketKipi} çapalı — npm run derle:<hedef>:${paketKipi}`);
if (kunye.testCapasi !== false) sorunlar.push('native TEST çapalı derleme (test-anchor) — pakete girmez');
if (sorunlar.length) {
  for (const s of sorunlar) console.error(`  ✖ ${s}`);
  process.exit(1);
}
console.log(`  çapa kipi  : ${paketKipi} (bayt kodu = native, test çapasız)`);
