// =============================================================================
// Etiket fontu yükleme (opentype.js lazy singleton) + metrik ölçümü
// =============================================================================
// DejaVu Sans (normal + bold) — gerçek Türkçe glif kapsamı (İ/Ş/Ğ/ç…) → native
// yolun asciiFold zorunluluğu raster'da KALKAR. Font dosyaları CWD/assets/fonts
// altından (app.ts publicDir kalıbı: dev = backend kökü, prod = pm2 `cwd`).
// Yüklenemezse Türkçe Error → çağıran (registry) komut moduna düşer (baskı durmaz).
// =============================================================================

import { readFileSync } from "fs";
import path from "path";
import opentype, { type Font } from "opentype.js";

export type RasterFontStyle = "normal" | "bold";

const FONT_FILES: Record<RasterFontStyle, string> = {
  normal: "DejaVuSans.ttf",
  bold: "DejaVuSans-Bold.ttf",
};

export interface LabelFontMetrics {
  font: Font;
  unitsPerEm: number;
  /** Büyük harf ('H') yüksekliği / em — hedef mm (cap yüksekliği) → fontSize eşlemesi. */
  capRatio: number;
}

const cache = new Map<RasterFontStyle, LabelFontMetrics>();

export function getLabelFontMetrics(style: RasterFontStyle): LabelFontMetrics {
  const hit = cache.get(style);
  if (hit) return hit;

  const file = path.join(process.cwd(), "assets", "fonts", FONT_FILES[style]);
  let font: Font;
  try {
    font = opentype.parse(readFileSync(file));
  } catch (e) {
    throw new Error(
      `Etiket fontu yüklenemedi: assets/fonts/${FONT_FILES[style]} — ${(e as Error).message}`,
    );
  }

  // Cap height'i 'H' glifinin bbox'ından ölç (OS/2 sCapHeight garanti değil).
  // getPath(0, 0, upem): baseline y=0, üst kenar NEGATİF y (y aşağı artar).
  const upem = font.unitsPerEm;
  let capRatio = 0.7; // güvenli varsayılan (font ölçülemezse)
  try {
    const bb = font.charToGlyph("H").getPath(0, 0, upem).getBoundingBox();
    const cap = -bb.y1;
    if (cap > 0 && cap <= upem * 1.5) capRatio = cap / upem;
  } catch {
    /* varsayılanı kullan */
  }

  const m: LabelFontMetrics = { font, unitsPerEm: upem, capRatio };
  cache.set(style, m);
  return m;
}

export function getLabelFont(style: RasterFontStyle): Font {
  return getLabelFontMetrics(style).font;
}
