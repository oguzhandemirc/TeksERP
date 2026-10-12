// =============================================================================
// Etiket/belge barkod SVG'si — bwip-js raw() geometrisinden <path>, içerik önbellekli
// =============================================================================
// bwip'in toSVG'si etiket başına ~7 ms senkron CPU'dur (yazı tipi/ölçek boru hattı);
// raw() aynı modül geometrisini ~0,1 ms'de verir. Çıktı toSVG ile AYNI viewBox'ı ve
// aynı kara modülleri taşır (bekçi: test_barcode_svg §1), şablonlar fark etmez.
// =============================================================================

import bwipjs from "bwip-js";

/** toSVG ile aynı birim: bwip modül genişliği 1 px × scale; QR modülü 2 px × scale. */
const SCALE = 3;
const QR_MODULE_PX = 2 * SCALE;
/** bwip yüksekliği mm verir: 72 dpi'da px'e çevrilip yukarı yuvarlanır (toSVG ile aynı). */
const CODE128_HEIGHT_MM = 10;

/** İçerik → SVG; en uzun süre dokunulmayan düşer (Map ekleme sırası). Tavan: en büyük
 *  toplu baskı (2.000 top) × iki sembol — daha azı yeniden basımda önbelleği boşa döndürür. */
export const BARCODE_SVG_CACHE_MAX = 4000;
const cache = new Map<string, string>();
let hits = 0;
let misses = 0;

function cached(key: string, text: string, build: () => string): string {
  // toSVG boş metinde hata verir, raw() Code128'de vermez: davranış eskisi gibi kalsın.
  if (!text) throw new ReferenceError("bwip-js: bar code text not specified.");
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    hits++;
    return hit;
  }
  misses++;
  const svg = build();
  cache.set(key, svg);
  if (cache.size > BARCODE_SVG_CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return svg;
}

function wrap(w: number, h: number, d: string): string {
  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">\n` +
    `<rect width="100%" height="100%" fill="#FFFFFF" />\n` +
    `<path fill="#000000" shape-rendering="crispEdges" d="${d}" />\n</svg>\n`
  );
}

interface RawLinear {
  sbs: number[];
  bhs: number[];
}
interface RawMatrix {
  pixs: ArrayLike<number>;
  pixx: number;
  pixy: number;
}

function buildCode128(text: string): string {
  const res = bwipjs.raw({ bcid: "code128", text, height: CODE128_HEIGHT_MM }) as unknown as RawLinear[];
  const sbs = res[0]?.sbs ?? [];
  const h = Math.ceil(((CODE128_HEIGHT_MM * 72) / 25.4) * SCALE);
  let x = 0;
  let d = "";
  for (let i = 0; i < sbs.length; i++) {
    const w = sbs[i]! * SCALE;
    if ((i & 1) === 0) d += `M${x} 0h${w}v${h}h${-w}Z`;
    x += w;
  }
  return wrap(x, h, d);
}

function buildQr(text: string): string {
  const res = bwipjs.raw({ bcid: "qrcode", text }) as unknown as RawMatrix[];
  const m = res[0];
  if (!m) throw new Error("QR üretilemedi");
  let d = "";
  for (let y = 0; y < m.pixy; y++) {
    const row = y * m.pixx;
    let x = 0;
    while (x < m.pixx) {
      if (!m.pixs[row + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < m.pixx && m.pixs[row + x]) x++;
      const w = (x - start) * QR_MODULE_PX;
      d += `M${start * QR_MODULE_PX} ${y * QR_MODULE_PX}h${w}v${QR_MODULE_PX}h${-w}Z`;
    }
  }
  return wrap(m.pixx * QR_MODULE_PX, m.pixy * QR_MODULE_PX, d);
}

/** Code128 (scale 3, 10 mm, yazısız, beyaz zemin) — eski `toSVG` çağrısının eşdeğeri. */
export function renderCode128Svg(text: string): string {
  return cached(`c128|${text}`, text, () => buildCode128(text));
}

/** QR (scale 3, beyaz zemin) — eski `toSVG` çağrısının eşdeğeri. */
export function renderQrSvg(text: string): string {
  return cached(`qr|${text}`, text, () => buildQr(text));
}

export function barcodeSvgCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits, misses };
}

export function clearBarcodeSvgCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}

/** Toplu etikette tek bloğun üst süresi: aşılınca event-loop'a dönülür (diğer istasyonların soketleri). */
export const BULK_LABEL_SLICE_MS = 15;

/** Zaman dilimli nefes: her çağrıda bütçe aşıldıysa setImmediate ile check fazına döner. */
export function createSliceYielder(sliceMs = BULK_LABEL_SLICE_MS): () => Promise<void> {
  let sliceStart = performance.now();
  return async () => {
    if (performance.now() - sliceStart < sliceMs) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
    sliceStart = performance.now();
  };
}
