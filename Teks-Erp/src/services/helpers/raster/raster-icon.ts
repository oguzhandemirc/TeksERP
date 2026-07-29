// =============================================================================
// İkon rasterizer — bakım sembolü primitifleri → 1bpp bitmap
// =============================================================================
// label-icons kayıt defterindeki IconPrimitive listesini (0..100 birim uzayı,
// y aşağı) hedef kare bitmap'e döker. Kontur = segment boyunca ≤0.5 dot adımla
// dolu disk damgalama (yuvarlak uçlar bedavaya gelir); dolgu = piksel-merkezi
// örneklemeli even-odd scanline (raster-text.ts scanlineFill yaklaşımı). Metin
// mevcut raster-text/raster-font hattından (bold, cap-yükseklik ölçekli) gelir.
// Sıfır ek bağımlılık — SVG üretimi (label-icons.ts) ile aynı geometri.
// =============================================================================

import { Bitmap1, type Rotation } from "./raster-bitmap";
import { renderTextBitmap } from "./raster-text";
import { getLabelIcon, ICON_DEFAULT_STROKE, type IconPrimitive } from "../../../config/label-icons";

type Pt = [number, number];

/** SENKRON çekirdek — ikon anahtarını sizeDots×sizeDots kare bitmap'e rasterize et.
 *  Gövde tümüyle senkron (SVG/font I/O yok; label-icons kayıt defteri statik). Async
 *  renderIconBitmap bunu sarar (uniform async ikon arayüzü — raster boru hattı); native
 *  KOMUT yolu (emitCanvasPplb GW inline grafik) SENKRON gereksinimiyle BUNU doğrudan çağırır.
 *  Bilinmeyen anahtar → Türkçe Error (çağıran 400'e çevirir/atlar). */
export function iconBitmap(iconKey: string, sizeDots: number): Bitmap1 {
  const def = getLabelIcon(iconKey);
  if (!def) throw new Error(`Bilinmeyen etiket ikonu: '${iconKey}'`);
  const size = Math.max(1, Math.floor(sizeDots));
  const bmp = new Bitmap1(size, size);
  const s = size / 100; // birim → dot ölçeği
  for (const prim of def.prims) drawPrim(bmp, prim, s);
  return bmp;
}

/** İkon anahtarını sizeDots×sizeDots kare bitmap'e rasterize et (async sarıcı — bkz. iconBitmap). */
export async function renderIconBitmap(iconKey: string, sizeDots: number): Promise<Bitmap1> {
  return iconBitmap(iconKey, sizeDots);
}

/** İkonu hedef bitmap'e (xDots,yDots = sol-üst) rot ile bas — kare olduğundan
 *  ayak izi dönüşte değişmez (raster-canvas'ın temp-bitmap rotate-blit kalıbı). */
export async function drawIconOnBitmap(
  target: Bitmap1,
  iconKey: string,
  xDots: number,
  yDots: number,
  sizeDots: number,
  rot: Rotation = 0,
): Promise<void> {
  const icon = await renderIconBitmap(iconKey, sizeDots);
  target.blit(icon, xDots, yDots, rot);
}

// -----------------------------------------------------------------------------
// Primitif dağıtımı
// -----------------------------------------------------------------------------

/** Kontur kalınlığı (birim) → damga yarıçapı (dot). Min 1 dot çizgi; 0.71 dot
 *  yarıçap tabanı piksel-merkezi örneklemede "hiç piksel düşmedi" boşluğunu önler. */
function strokeRadius(w: number | undefined, s: number): number {
  const dots = Math.max(1, Math.round((w ?? ICON_DEFAULT_STROKE) * s));
  return Math.max(0.71, dots / 2);
}

function drawPrim(bmp: Bitmap1, p: IconPrimitive, s: number): void {
  switch (p.t) {
    case "line":
      strokeSeg(bmp, p.x1 * s, p.y1 * s, p.x2 * s, p.y2 * s, strokeRadius(p.w, s));
      break;
    case "pline": {
      const r = strokeRadius(p.w, s);
      const pts: Pt[] = p.pts.map(([x, y]) => [x * s, y * s]);
      const n = p.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        strokeSeg(bmp, a[0], a[1], b[0], b[1], r);
      }
      break;
    }
    case "poly":
      fillPolyEvenOdd(bmp, p.pts.map(([x, y]) => [x * s, y * s]));
      break;
    case "circle":
      if (p.fill) fillDisc(bmp, p.cx * s, p.cy * s, Math.max(0.71, p.r * s));
      else strokeArc(bmp, p.cx * s, p.cy * s, p.r * s, 0, 360, strokeRadius(p.w, s));
      break;
    case "arc":
      strokeArc(bmp, p.cx * s, p.cy * s, p.r * s, p.a1, p.a2, strokeRadius(p.w, s));
      break;
    case "text":
      drawCenteredText(bmp, p.x * s, p.y * s, p.s, Math.max(1, Math.round(p.h * s)));
      break;
  }
}

// -----------------------------------------------------------------------------
// Çekirdek çizim: disk damgalama + scanline dolgu
// -----------------------------------------------------------------------------

/** Dolu disk — piksel merkezi (x+0.5, y+0.5) daire içindeyse boya. */
function fillDisc(bmp: Bitmap1, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  const y0 = Math.floor(cy - r);
  const y1 = Math.ceil(cy + r);
  const x0 = Math.floor(cx - r);
  const x1 = Math.ceil(cx + r);
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (dx * dx + dy * dy <= r2) bmp.set(x, y);
    }
  }
}

/** Konturlu doğru parçası — ≤0.5 dot adımla disk damgala (yuvarlak uçlu). */
function strokeSeg(bmp: Bitmap1, x1: number, y1: number, x2: number, y2: number, r: number): void {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(len / 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillDisc(bmp, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r);
  }
}

/** Yay konturu — a1→a2 derece (0°=saat 3, saat-yönü-tersi pozitif, y AŞAĞI:
 *  nokta = (cx + r·cos, cy − r·sin) — SVG üretimiyle (label-icons.ts) birebir).
 *  Tam daire için a1=0, a2=360. Yay boyunca ≤0.5 dot adımla damgalanır. */
function strokeArc(
  bmp: Bitmap1,
  cx: number,
  cy: number,
  r: number,
  a1: number,
  a2: number,
  strokeR: number,
): void {
  const arcLen = (Math.abs(a2 - a1) / 360) * 2 * Math.PI * Math.max(0.1, r);
  const steps = Math.max(1, Math.ceil(arcLen / 0.5));
  for (let i = 0; i <= steps; i++) {
    const a = ((a1 + ((a2 - a1) * i) / steps) * Math.PI) / 180;
    fillDisc(bmp, cx + r * Math.cos(a), cy - r * Math.sin(a), strokeR);
  }
}

/** Even-odd scanline dolgu — piksel merkezi (y+0.5) örneklemeli
 *  (raster-text.ts scanlineFill'in non-zero yerine even-odd hali). */
function fillPolyEvenOdd(bmp: Bitmap1, pts: Pt[]): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(bmp.heightDots - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      if (a[1] === b[1]) continue;
      if ((yc >= a[1] && yc < b[1]) || (yc >= b[1] && yc < a[1])) {
        xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.round(xs[i]);
      const xb = Math.round(xs[i + 1]);
      for (let x = xa; x < xb; x++) bmp.set(x, y);
    }
  }
}

/** Metni (x,y) MERKEZLİ bas — mürekkep sınır kutusu üzerinden ortalanır (hücre
 *  yüksekliği descender payı içerir; rakam/büyük harfte görsel merkez kayardı). */
function drawCenteredText(bmp: Bitmap1, x: number, y: number, text: string, capDots: number): void {
  const run = renderTextBitmap(text, { heightDots: capDots, bold: true });
  let minX = run.widthDots;
  let minY = run.heightDots;
  let maxX = -1;
  let maxY = -1;
  for (let yy = 0; yy < run.heightDots; yy++) {
    for (let xx = 0; xx < run.widthDots; xx++) {
      if (!run.get(xx, yy)) continue;
      if (xx < minX) minX = xx;
      if (xx > maxX) maxX = xx;
      if (yy < minY) minY = yy;
      if (yy > maxY) maxY = yy;
    }
  }
  if (maxX < 0) return; // boş metin — iz yok
  const dx = Math.round(x - (minX + maxX + 1) / 2);
  const dy = Math.round(y - (minY + maxY + 1) / 2);
  bmp.blit(run, dx, dy);
}
