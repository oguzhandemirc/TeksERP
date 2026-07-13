// =============================================================================
// Barkod/QR rasterizer — bwip-js düşük seviye raw() geometrisi → 1bpp blit
// =============================================================================
// PNG/SVG decode YOK: bwip-js.raw() modül geometrisini verir, biz TAM DOT boyutunda
// dikdörtgen bloklarla çizeriz → 203/300dpi'da bar/modül genişliği tam sayı dot
// (okunabilirlik garantisi). Sessiz bölge eklenmez — bwip çıplak sembol verir
// (native-preview.ts ile aynı model; sessiz bölge beyaz kağıtta zaten kalır).
// =============================================================================

import bwipjs from "bwip-js";
import { Bitmap1 } from "./raster-bitmap";

interface RawLinear {
  sbs: number[];
}
interface RawMatrix {
  pixs: ArrayLike<number>;
  pixx: number;
  pixy: number;
}

/** Code128 — raw().sbs modül dizisiyle TAM DOT çubuk. sbs: çift index = bar (siyah),
 *  tek index = boşluk. Dönüş: kesin toplam genişlik (dot; okunur satırı ortalamak
 *  için). Üretilemezse null (çağıran atlar). */
export function drawCode128(
  bmp: Bitmap1,
  xDots: number,
  yDots: number,
  data: string,
  opts: { heightDots: number; moduleDots: number },
): { widthDots: number } | null {
  try {
    const res = bwipjs.raw({ bcid: "code128", text: data }) as unknown as RawLinear[];
    const sbs = res?.[0]?.sbs;
    if (!sbs || !sbs.length) return null;
    const mw = Math.max(1, Math.round(opts.moduleDots));
    const h = Math.max(1, Math.round(opts.heightDots));
    const y = Math.round(yDots);
    let cx = Math.round(xDots);
    const startX = cx;
    for (let i = 0; i < sbs.length; i++) {
      const w = sbs[i] * mw;
      if ((i & 1) === 0) bmp.fillRect(cx, y, w, h); // çift = bar
      cx += w;
    }
    return { widthDots: cx - startX };
  } catch {
    return null;
  }
}

/** QR — raw().pixs (satır-major 0/1) matrisiyle TAM DOT blok. Dönüş: kenar uzunluğu
 *  (dot). Üretilemezse null. */
export function drawQr(
  bmp: Bitmap1,
  xDots: number,
  yDots: number,
  data: string,
  moduleDots: number,
): { sideDots: number } | null {
  try {
    const res = bwipjs.raw({ bcid: "qrcode", text: data }) as unknown as RawMatrix[];
    const m = res?.[0];
    if (!m || !m.pixs || !m.pixx || !m.pixy) return null;
    const mod = Math.max(1, Math.round(moduleDots));
    const x0 = Math.round(xDots);
    const y0 = Math.round(yDots);
    for (let my = 0; my < m.pixy; my++) {
      const rowOff = my * m.pixx;
      for (let mx = 0; mx < m.pixx; mx++) {
        if (m.pixs[rowOff + mx]) bmp.fillRect(x0 + mx * mod, y0 + my * mod, mod, mod);
      }
    }
    return { sideDots: m.pixx * mod };
  } catch {
    return null;
  }
}
