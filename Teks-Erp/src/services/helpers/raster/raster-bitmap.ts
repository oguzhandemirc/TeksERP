// =============================================================================
// 1bpp bitmap çekirdeği — raster etiket boru hattının temel görüntü tamponu
// =============================================================================
// MSB-first, satır-major, 1 = SİYAH (iç konvansiyon — dil zarfı polariteyi kendi
// çevirir: EPL2 GW'de 1=beyaz olduğu için orada invert edilir, ZPL ^GF'de 1=siyah
// olduğu için değil). Sol-üst orijin, y AŞAĞI artar (kanvas/ekranla aynı → yazıcıya
// tek imaj gider, koordinat sistemi dert değil). Sıfır bağımlılık.
// =============================================================================

export type Rotation = 0 | 90 | 180 | 270;

export class Bitmap1 {
  readonly widthDots: number;
  readonly heightDots: number;
  /** Satır başına bayt = ceil(width/8) — MSB-first paketleme. */
  readonly rowBytes: number;
  /** Piksel verisi (rowBytes × heightDots). 1 biti = siyah nokta; 0 = beyaz. */
  readonly data: Uint8Array;

  constructor(widthDots: number, heightDots: number) {
    const w = Math.floor(widthDots);
    const h = Math.floor(heightDots);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 0 || h < 0) {
      throw new Error("Bitmap1: geçersiz boyut");
    }
    this.widthDots = w;
    this.heightDots = h;
    this.rowBytes = Math.ceil(w / 8);
    this.data = new Uint8Array(this.rowBytes * h); // sıfır = tümü beyaz
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.widthDots && y < this.heightDots;
  }

  /** Tek piksel — sınır dışı sessizce yok sayılır (kırpma). */
  set(x: number, y: number, on = true): void {
    x = x | 0;
    y = y | 0;
    if (!this.inBounds(x, y)) return;
    const idx = y * this.rowBytes + (x >> 3);
    const bit = 0x80 >> (x & 7);
    if (on) this.data[idx] |= bit;
    else this.data[idx] &= ~bit & 0xff;
  }

  get(x: number, y: number): boolean {
    x = x | 0;
    y = y | 0;
    if (!this.inBounds(x, y)) return false;
    return (this.data[y * this.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
  }

  /** Dolu dikdörtgen (siyah). Sınır otomatik kırpılır. */
  fillRect(x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.widthDots, Math.floor(x) + Math.floor(w));
    const y1 = Math.min(this.heightDots, Math.floor(y) + Math.floor(h));
    for (let yy = y0; yy < y1; yy++) {
      const base = yy * this.rowBytes;
      for (let xx = x0; xx < x1; xx++) {
        this.data[base + (xx >> 3)] |= 0x80 >> (xx & 7);
      }
    }
  }

  /** İçi boş çerçeve — kalınlık t dot (dört kenar dolu dikdörtgen). */
  frameRect(x: number, y: number, w: number, h: number, t: number): void {
    t = Math.max(1, Math.floor(t));
    x = Math.floor(x);
    y = Math.floor(y);
    w = Math.floor(w);
    h = Math.floor(h);
    this.fillRect(x, y, w, t); // üst
    this.fillRect(x, y + h - t, w, t); // alt
    this.fillRect(x, y, t, h); // sol
    this.fillRect(x + w - t, y, t, h); // sağ
  }

  /** Dikdörtgen içindeki bitleri ters çevir (lengthBanner beyaz değer / genel invert). */
  invertRect(x: number, y: number, w: number, h: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.widthDots, Math.floor(x) + Math.floor(w));
    const y1 = Math.min(this.heightDots, Math.floor(y) + Math.floor(h));
    for (let yy = y0; yy < y1; yy++) {
      const base = yy * this.rowBytes;
      for (let xx = x0; xx < x1; xx++) {
        this.data[base + (xx >> 3)] ^= 0x80 >> (xx & 7);
      }
    }
  }

  /** Kaynak bitmap'i (dx,dy) konumuna bas; rot ile 90/180/270 döndür.
   *  mode "or" → siyah pikseller birleşir (varsayılan); "clear" → siyah pikseller
   *  hedefte BEYAZLATILIR (siyah bant üstüne beyaz metin damgalamak için). */
  blit(src: Bitmap1, dx: number, dy: number, rot: Rotation = 0, mode: "or" | "clear" = "or"): void {
    dx = Math.floor(dx);
    dy = Math.floor(dy);
    const sw = src.widthDots;
    const sh = src.heightDots;
    const on = mode === "or";
    for (let sy = 0; sy < sh; sy++) {
      for (let sx = 0; sx < sw; sx++) {
        if (!src.get(sx, sy)) continue;
        let ox: number;
        let oy: number;
        switch (rot) {
          case 90:
            ox = sh - 1 - sy;
            oy = sx;
            break;
          case 180:
            ox = sw - 1 - sx;
            oy = sh - 1 - sy;
            break;
          case 270:
            ox = sy;
            oy = sw - 1 - sx;
            break;
          default:
            ox = sx;
            oy = sy;
            break;
        }
        this.set(dx + ox, dy + oy, on);
      }
    }
  }

  /** y satırının bayt dilimi (rowBytes bayt) — zarf/BMP kodlayıcı için (kopya değil, view). */
  row(y: number): Uint8Array {
    const off = (y | 0) * this.rowBytes;
    return this.data.subarray(off, off + this.rowBytes);
  }
}

/** rot ile döndürülmüş yeni boyut (90/270 → en↔boy takas). */
export function rotatedSize(w: number, h: number, rot: Rotation): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}
