// =============================================================================
// 1bpp Windows BMP kodlayıcı + önizleme HTML kabuğu (sıfır bağımlılık)
// =============================================================================
// Önizleme taşıyıcısı: bitmap → BMP data-URI → <img image-rendering:pixelated>.
// Böylece "Kod sekmesi" ham komut yerine GERÇEK basılacak pikseli gösterir.
// BMP tuzakları: satırlar 4-bayta pad'li + ALTTAN-ÜSTE; bit MSB-first (iç düzenle
// aynı); palet[1]=siyah (iç 1=siyah konvansiyonuyla hizalı); piksel ofseti 62.
// =============================================================================

import { Bitmap1 } from "./raster-bitmap";

export function encodeBmp1(bmp: Bitmap1): Buffer {
  const w = bmp.widthDots;
  const h = bmp.heightDots;
  const stride = ((w + 31) >> 5) << 2; // 4-bayt hizalı satır uzunluğu (bayt)
  const pixelBytes = stride * h;
  const offBits = 14 + 40 + 8; // FILEHEADER + INFOHEADER + 2×4 palet = 62
  const fileSize = offBits + pixelBytes;

  const buf = Buffer.alloc(fileSize);
  // --- BITMAPFILEHEADER (14) ---
  buf.write("BM", 0, "latin1");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6); // reserved
  buf.writeUInt32LE(offBits, 10);
  // --- BITMAPINFOHEADER (40) ---
  buf.writeUInt32LE(40, 14); // biSize
  buf.writeInt32LE(w, 18); // biWidth
  buf.writeInt32LE(h, 22); // biHeight (+ = ALTTAN-ÜSTE)
  buf.writeUInt16LE(1, 26); // biPlanes
  buf.writeUInt16LE(1, 28); // biBitCount = 1
  buf.writeUInt32LE(0, 30); // biCompression = BI_RGB
  buf.writeUInt32LE(pixelBytes, 34); // biSizeImage
  buf.writeInt32LE(2835, 38); // ~72 DPI (yatay)
  buf.writeInt32LE(2835, 42); // ~72 DPI (dikey)
  buf.writeUInt32LE(2, 46); // biClrUsed = 2
  buf.writeUInt32LE(0, 50); // biClrImportant
  // --- Palet (BGRA): index0 = beyaz, index1 = siyah ---
  buf.writeUInt32LE(0x00ffffff, 54); // beyaz (B,G,R,0)
  buf.writeUInt32LE(0x00000000, 58); // siyah
  // --- Piksel verisi — alttan üste; her satır rowBytes kopyalanır, kalan pad=0 ---
  for (let y = 0; y < h; y++) {
    const srcRow = bmp.row(h - 1 - y);
    buf.set(srcRow, offBits + y * stride);
  }
  return buf;
}

export function bmpDataUri(bmp: Bitmap1): string {
  return "data:image/bmp;base64," + encodeBmp1(bmp).toString("base64");
}

/** Önizleme HTML kabuğu — bitmap fiziksel mm boyutunda, pixelated ölçekleme.
 *  {mode:"html", content} sözleşmesi içinde kalır → frontend iframe srcDoc değişmez. */
export function rasterPreviewHtml(bmp: Bitmap1, widthMm: number, heightMm: number): string {
  const uri = bmpDataUri(bmp);
  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;background:#f4f4f5;display:flex;align-items:center;justify-content:center;min-height:100vh}` +
    `img{width:${widthMm}mm;height:${heightMm}mm;image-rendering:pixelated;background:#fff;box-shadow:0 1px 6px rgba(0,0,0,.25)}` +
    `</style></head><body><img src="${uri}" alt="etiket önizleme"></body></html>`
  );
}
