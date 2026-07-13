// =============================================================================
// PPLB (EPL2) raster zarfı — 1bpp bitmap'i GW (Direct Graphic Write) ile sarar
// =============================================================================
// Format (Zebra EPL2): `GWp1,p2,p3,p4DATA` — p4 sonrası AYRAÇ YOK, DATA hemen gelir.
// p1=x dot, p2=y dot, p3=BAYT genişliği (=rowBytes), p4=dot yüksekliği. DATA = p3×p4
// ham bayt (top-down; iç bitmap düzeniyle aynı). Baytlar Buffer.concat ile birleşir —
// binary blok HİÇBİR string/regex/CRLF-normalize yolundan geçmez.
// =============================================================================

import { Bitmap1 } from "./raster-bitmap";
import { mmToDots, clampCopies } from "../native-label.shared";
import type { ResolvedLabelFormat } from "../label-format.resolver";

const CRLF = "\r\n";

/** ⚠ EPL2 GW polaritesi: yaygın kabul '1' bit = BEYAZ (baskı yok), '0' = SİYAH (dot).
 *  İç bitmap 1=siyah olduğundan bitler INVERT edilir. Fiziksel testte NEGATİF çıkarsa
 *  (siyah zemin/beyaz görüntü) bu sabiti false yap — tek satır düzeltme. Bkz. plan F6.3. */
const GW_ONE_IS_WHITE = true;

export function wrapPplbRaster(bmp: Bitmap1, format: ResolvedLabelFormat, copies: number): Buffer {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);

  // Görüntü verisi (gerekirse polarite invert edilmiş kopya).
  const img = Buffer.from(bmp.data);
  if (GW_ONE_IS_WHITE) {
    for (let i = 0; i < img.length; i++) img[i] = ~img[i] & 0xff;
  }

  const head = Buffer.from(
    "N" + CRLF +
      `q${d(format.widthMm)}` + CRLF +
      `Q${d(format.heightMm)},${d(format.gapMm)}` + CRLF +
      "D8" + CRLF +
      `GW0,0,${bmp.rowBytes},${bmp.heightDots}`, // ← DATA hemen ardından gelir (ayraç yok)
    "latin1",
  );
  const tail = Buffer.from(CRLF + `P${clampCopies(copies)}` + CRLF, "latin1");
  return Buffer.concat([head, img, tail]);
}
