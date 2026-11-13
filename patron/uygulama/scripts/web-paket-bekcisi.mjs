#!/usr/bin/env node
// Web paketi bekçisi: `expo export --platform web` çıktısındaki JS'te blob işçisi (`new Worker(` + createObjectURL/`blob:`)
// ve expo-camera izi OLMAZ. Bulut sıkı CSP (`worker-src 'self'`) ile sunar; blob işçisi giriş sayfasında ihlal üretir
// (PR #688 dersi). CSP gevşetilmez, modül web paketinden çıkarılır. Çıkış: 0 temiz · 1 ihlal · 2 ölçülemedi.
// Kullanım: node scripts/web-paket-bekcisi.mjs [dist-dizini]  (varsayılan: dist — CI'daki export adımının çıktısı)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dizin = path.resolve(process.argv[2] ?? "dist");
const PENCERE = 400;
// expo-camera'nın web kodu: modül adı hata iletilerinde, QR çözücü (jsQR) blob işçisine gömülü.
const MODUL_IZI = [/expo-camera/g, /\bjsQR\b/g];

function jsDosyalari(d) {
  const out = [];
  for (const ad of readdirSync(d)) {
    const y = path.join(d, ad);
    if (statSync(y).isDirectory()) out.push(...jsDosyalari(y));
    else if (/\.(?:m?js|cjs)$/.test(ad)) out.push(y);
  }
  return out;
}

if (!existsSync(dizin) || !statSync(dizin).isDirectory()) {
  console.error(`web-paket-bekcisi: ÖLÇÜLEMEDİ — dizin yok: ${dizin} (önce: npx expo export --platform web --output-dir dist)`);
  process.exit(2);
}
const dosyalar = jsDosyalari(dizin);
if (dosyalar.length === 0) {
  console.error(`web-paket-bekcisi: ÖLÇÜLEMEDİ — ${dizin} altında JS paketi yok`);
  process.exit(2);
}

const ihlaller = [];
let isciSayisi = 0;
for (const y of dosyalar) {
  const metin = readFileSync(y, "utf8");
  const ad = path.relative(dizin, y);
  for (const m of metin.matchAll(/new\s+Worker\s*\(/g)) {
    isciSayisi += 1;
    const pencere = metin.slice(Math.max(0, m.index - PENCERE), m.index + PENCERE);
    if (/createObjectURL|["'`]blob:/.test(pencere)) ihlaller.push(`${ad}: blob işçisi — …${metin.slice(m.index, m.index + 80)}…`);
  }
  for (const re of MODUL_IZI) {
    const n = [...metin.matchAll(re)].length;
    if (n > 0) ihlaller.push(`${ad}: ${re.source} izi ×${n}`);
  }
}

if (ihlaller.length > 0) {
  console.error(`web-paket-bekcisi: İHLAL (${ihlaller.length}) — web paketine blob işçisi / expo-camera girmez; CSP gevşetilmez.`);
  for (const s of ihlaller) console.error(`  · ${s}`);
  console.error("  Çare: modülü platform dosyasına ayır (`X.native.tsx` kameralı, `X.tsx` kamerasız) — bkz. src/ui/diger/KarekodOkut.tsx");
  process.exit(1);
}
console.log(`web-paket-bekcisi: temiz — ${dosyalar.length} JS dosyası, new Worker( ×${isciSayisi} (blob'suz), expo-camera izi 0`);
