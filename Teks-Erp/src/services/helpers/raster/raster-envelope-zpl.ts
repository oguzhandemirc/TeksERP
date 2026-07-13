// =============================================================================
// ZPL (Zebra) raster zarfı — 1bpp bitmap'i ^GFA (ASCII-hex grafik) ile sarar
// =============================================================================
// ^GFA,{binaryByteCount},{graphicFieldCount},{bytesPerRow},{HEX} — ASCII-hex olduğu
// için binary transport GEREKTİRMEZ (en risksiz dil) ama tek yoldan gitmesi için
// Buffer döner. ^GF polaritesi: 1 bit = SİYAH → invert YOK. total = rowBytes×height.
// =============================================================================

import { Bitmap1 } from "./raster-bitmap";
import { mmToDots, clampCopies, mediaTypeCommand } from "../native-label.shared";
import type { ResolvedLabelFormat } from "../label-format.resolver";

export function wrapZplRaster(bmp: Bitmap1, format: ResolvedLabelFormat, copies: number): Buffer {
  const dpi = format.dpi || 203;
  const d = (mm: number) => mmToDots(mm, dpi);
  const total = bmp.rowBytes * bmp.heightDots;
  const hex = Buffer.from(bmp.data).toString("hex").toUpperCase();

  const mc = mediaTypeCommand(format.language, format.mediaType);
  const lines = [
    "^XA",
    ...(mc ? [mc] : []),
    "^CI28",
    `^PW${d(format.widthMm)}`,
    `^LL${d(format.heightMm)}`,
    `^FO0,0^GFA,${total},${total},${bmp.rowBytes},${hex}^FS`,
    `^PQ${clampCopies(copies)}`,
    "^XZ",
  ];
  return Buffer.from(lines.join("\n") + "\n", "latin1");
}
