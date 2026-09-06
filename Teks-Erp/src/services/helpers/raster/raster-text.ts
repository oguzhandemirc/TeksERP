// =============================================================================
// Metin rasterizer — glif konturu → scanline dolgu (non-zero winding)
// =============================================================================
// opentype.js glif-glif render (font.getPath(string) DejaVu GSUB'da çöküyor →
// charToGlyph(ch).getPath baypas eder; advance'i biz kontrol ederiz, wr uygular).
// Konturlar M/L/Q/C ile gelir; bézier'ler ~0.35 dot toleransla düzleştirilir, sonra
// piksel-merkezi örneklemeli non-zero winding taramasıyla doldurulur. Rotasyon:
// metin YATAY temp bitmap'e çizilir → rotate-blit (raster-bitmap.blit).
// =============================================================================

import { type PathCommand } from "opentype.js";
import { Bitmap1, type Rotation } from "./raster-bitmap";
import { getLabelFontMetrics } from "./raster-font";

export interface TextRasterOpts {
  /** Hedef büyük-harf yüksekliği (dot) — fontSize buradan (capRatio ile). */
  heightDots: number;
  /** Genişlik oranı (wr) — yatay ölçek; 1 = doğal. */
  widthRatio?: number;
  bold?: boolean;
  rot?: Rotation;
}

/** Yalnız kontrol karakteri temizliği + trim. asciiFold YOK — Türkçe glifler
 *  (İ/Ş/Ğ/ç…) gerçek konturla basılır (native yolun asciiFold'u burada uygulanmaz). */
export function rasterCleanText(s: string | number | null | undefined): string {
  // Kontrol karakterleri boşluğa çevrilir — yazıcı akışını bozmasın.
  return String(s ?? "").replace(/[\x00-\x1f]/g, " ").trim();
}

/** Yatay (döndürülmemiş) metin bitmap'i üret — canvas banner'ı beyaz damga için
 *  bunu doğrudan alıp blit(...,"clear") çağırır; drawText normal OR için sarar. */
export function renderTextBitmap(text: string, opts: TextRasterOpts): Bitmap1 {
  const clean = rasterCleanText(text);
  const { font, unitsPerEm, capRatio } = getLabelFontMetrics(opts.bold ? "bold" : "normal");
  const wr = opts.widthRatio && opts.widthRatio > 0 ? opts.widthRatio : 1;
  const fontSize = Math.max(1, opts.heightDots / (capRatio || 0.7));
  const scale = fontSize / unitsPerEm;

  const ascentPx = font.ascender * scale;
  const descentPx = -font.descender * scale;
  const cellH = Math.max(1, Math.ceil(ascentPx + descentPx));
  const baseline = Math.round(ascentPx);

  if (!clean) return new Bitmap1(1, cellH);

  let totalAdv = 0;
  for (const ch of clean) totalAdv += font.charToGlyph(ch).advanceWidth * scale * wr;
  const runW = Math.max(1, Math.ceil(totalAdv) + 1);

  const bmp = new Bitmap1(runW, cellH);
  let penX = 0;
  for (const ch of clean) {
    const g = font.charToGlyph(ch);
    const path = g.getPath(0, baseline, fontSize); // origin x=0; penX+wr manuel
    fillGlyph(bmp, path.commands, penX, wr);
    penX += g.advanceWidth * scale * wr;
  }
  return bmp;
}

/** Metni hedef bitmap'e (x,y = sol-üst) rot ile bas (OR-birleşim). */
export function drawText(target: Bitmap1, x: number, y: number, text: string, opts: TextRasterOpts): void {
  const run = renderTextBitmap(text, opts);
  target.blit(run, x, y, opts.rot ?? 0);
}

/** Döndürülmemiş metin ölçüsü (dot). Rotasyon dış katmanda (rotatedSize). */
export function measureText(text: string, opts: TextRasterOpts): { widthDots: number; heightDots: number } {
  const clean = rasterCleanText(text);
  const { font, unitsPerEm, capRatio } = getLabelFontMetrics(opts.bold ? "bold" : "normal");
  const wr = opts.widthRatio && opts.widthRatio > 0 ? opts.widthRatio : 1;
  const scale = Math.max(1, opts.heightDots / (capRatio || 0.7)) / unitsPerEm;
  let adv = 0;
  for (const ch of clean) adv += font.charToGlyph(ch).advanceWidth * scale * wr;
  const cellH = Math.ceil(font.ascender * scale + -font.descender * scale);
  return { widthDots: Math.ceil(adv), heightDots: Math.max(1, cellH) };
}

// -----------------------------------------------------------------------------
// İç: kontur düzleştirme + scanline dolgu
// -----------------------------------------------------------------------------

type Pt = [number, number];

/** Bir glifin komutlarını (offX yatay ofset + wr yatay ölçek) konturlara çevirip doldur. */
function fillGlyph(bmp: Bitmap1, cmds: PathCommand[], offX: number, wr: number): void {
  const contours: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const tx = (x: number) => offX + x * wr;

  for (const c of cmds) {
    switch (c.type) {
      case "M":
        if (cur.length > 1) contours.push(cur);
        cur = [];
        cx = c.x!;
        cy = c.y!;
        sx = cx;
        sy = cy;
        cur.push([tx(cx), cy]);
        break;
      case "L":
        cx = c.x!;
        cy = c.y!;
        cur.push([tx(cx), cy]);
        break;
      case "Q":
        flattenQuad(cur, tx, cx, cy, c.x1!, c.y1!, c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        break;
      case "C":
        flattenCubic(cur, tx, cx, cy, c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!);
        cx = c.x!;
        cy = c.y!;
        break;
      case "Z":
        if (cur.length > 1) contours.push(cur);
        cur = [];
        cx = sx;
        cy = sy;
        break;
    }
  }
  if (cur.length > 1) contours.push(cur);
  scanlineFill(bmp, contours);
}

function flattenQuad(
  out: Pt[],
  tx: (x: number) => number,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
): void {
  const dev = Math.abs(x0 - 2 * x1 + x2) + Math.abs(y0 - 2 * y1 + y2);
  const steps = Math.max(2, Math.min(24, Math.ceil(Math.sqrt(dev / 0.35))));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const px = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
    const py = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
    out.push([tx(px), py]);
  }
}

function flattenCubic(
  out: Pt[],
  tx: (x: number) => number,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
): void {
  const dev =
    Math.abs(x0 - 2 * x1 + x2) + Math.abs(y0 - 2 * y1 + y2) +
    Math.abs(x1 - 2 * x2 + x3) + Math.abs(y1 - 2 * y2 + y3);
  const steps = Math.max(3, Math.min(32, Math.ceil(Math.sqrt(dev / 0.35))));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const dd = t * t * t;
    out.push([tx(a * x0 + b * x1 + c * x2 + dd * x3), a * y0 + b * y1 + c * y2 + dd * y3]);
  }
}

/** Non-zero winding scanline dolgu — piksel merkezi (y+0.5) örneklemeli. */
function scanlineFill(bmp: Bitmap1, contours: Pt[][]): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  if (!isFinite(minY)) return;
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(bmp.heightDots - 1, Math.ceil(maxY));
  const xs: { x: number; dir: number }[] = [];

  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const c of contours) {
      const n = c.length;
      for (let i = 0; i < n; i++) {
        const a = c[i];
        const b = c[(i + 1) % n];
        const ay = a[1];
        const by = b[1];
        if (ay === by) continue;
        if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) {
          const t = (yc - ay) / (by - ay);
          xs.push({ x: a[0] + t * (b[0] - a[0]), dir: by > ay ? 1 : -1 });
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p.x - q.x);
    let wind = 0;
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i].dir;
      if (wind !== 0) {
        const xa = Math.round(xs[i].x);
        const xb = Math.round(xs[i + 1].x);
        for (let x = xa; x < xb; x++) bmp.set(x, y);
      }
    }
  }
}
