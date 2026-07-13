// Raster metin testi (DB'siz): font yükleme + glif dolgu + Türkçe glif + wr/bold/rot.
// Koş: npx tsx scripts/test_raster_text.ts

import { Bitmap1 } from "../src/services/helpers/raster/raster-bitmap";
import { getLabelFontMetrics } from "../src/services/helpers/raster/raster-font";
import {
  rasterCleanText,
  renderTextBitmap,
  measureText,
} from "../src/services/helpers/raster/raster-text";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}`);
  } else {
    fail++;
    console.log(`❌ ${label}`);
  }
}

function inkCount(b: Bitmap1): number {
  let n = 0;
  for (let y = 0; y < b.heightDots; y++) for (let x = 0; x < b.widthDots; x++) if (b.get(x, y)) n++;
  return n;
}
function inkBBox(b: Bitmap1): { w: number; h: number; count: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let count = 0;
  for (let y = 0; y < b.heightDots; y++)
    for (let x = 0; x < b.widthDots; x++)
      if (b.get(x, y)) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return count ? { w: x1 - x0 + 1, h: y1 - y0 + 1, count } : { w: 0, h: 0, count: 0 };
}

// --- font yükleme + metrik ---
{
  const m = getLabelFontMetrics("normal");
  check("font yüklendi (unitsPerEm)", m.unitsPerEm > 0);
  check("capRatio makul (0.5–0.9)", m.capRatio > 0.5 && m.capRatio < 0.9);
  const b = getLabelFontMetrics("bold");
  check("bold font ayrı yüklendi", b.font !== m.font);
}

// --- rasterCleanText: kontrol temizliği + TÜRKÇE KORUNUR (asciiFold YOK) ---
{
  check("Türkçe korunur", rasterCleanText("İŞĞçöü") === "İŞĞçöü");
  check("kontrol karakteri → boşluk + trim", rasterCleanText("\x02AB\x1f") === "AB");
  check("boş/null güvenli", rasterCleanText(null) === "" && rasterCleanText(undefined) === "");
}

// --- temel ink ---
{
  const b = renderTextBitmap("HELLO", { heightDots: 24 });
  check("metin ink üretir", inkCount(b) > 20);
  check("genişlik > yükseklik (yatay kelime)", b.widthDots > b.heightDots);
}

// --- TÜRKÇE GLİF KANITI: Ş ≠ S, İ ≠ I, tüm Türkçe ink > 0 ---
{
  const sCount = inkCount(renderTextBitmap("S", { heightDots: 40 }));
  const sedCount = inkCount(renderTextBitmap("Ş", { heightDots: 40 }));
  check("Ş ink'i S'ten fazla (sedilla)", sedCount > sCount);
  const trAll = inkBBox(renderTextBitmap("İĞğşçÜ", { heightDots: 40 }));
  check("Türkçe küme ink üretir (boş değil)", trAll.count > 50);
  // İ (noktalı I) noktasıyla düz I'dan daha çok ink taşır
  const iCount = inkCount(renderTextBitmap("I", { heightDots: 40 }));
  const dotICount = inkCount(renderTextBitmap("İ", { heightDots: 40 }));
  check("İ ink'i I'dan fazla (nokta)", dotICount > iCount);
}

// --- wr (genişlik oranı) ~2× ---
{
  const w1 = measureText("MMMM", { heightDots: 30, widthRatio: 1 }).widthDots;
  const w2 = measureText("MMMM", { heightDots: 30, widthRatio: 2 }).widthDots;
  check("wr=2 genişliği ~2× yapar", Math.abs(w2 - 2 * w1) <= 3);
}

// --- bold > normal ink (aynı boyut) ---
{
  const nrm = inkCount(renderTextBitmap("B", { heightDots: 40, bold: false }));
  const bld = inkCount(renderTextBitmap("B", { heightDots: 40, bold: true }));
  check("bold ink ≥ normal ink", bld >= nrm);
}

// --- heightDots ≈ büyük harf yüksekliği ---
{
  const b = renderTextBitmap("H", { heightDots: 40 });
  const bb = inkBBox(b);
  check("H ink yüksekliği ≈ 40 (±%18)", Math.abs(bb.h - 40) <= 40 * 0.18);
}

// --- rot=90 bbox transpozesi (yatay kelime → dikey blok) ---
{
  const horiz = renderTextBitmap("WIDE", { heightDots: 24 });
  const bbH = inkBBox(horiz);
  const target = new Bitmap1(horiz.heightDots + 4, horiz.widthDots + 4);
  target.blit(horiz, 0, 0, 90);
  const bbR = inkBBox(target);
  check("rot90 blok dikey (yükseklik > genişlik)", bbR.h > bbR.w);
  check("rot90 boyut transpoze (~takas)", Math.abs(bbR.h - bbH.w) <= 3 && Math.abs(bbR.w - bbH.h) <= 3);
}

console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
process.exit(fail > 0 ? 1 : 0);
