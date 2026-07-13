// =============================================================================
// PPLA (Datamax/DPL) raster zarfı — 1bpp bitmap'i grafik indir+yerleştir ile sarar
// =============================================================================
// Byte formatı ÇALIŞAN bir kütüphaneden türetildi (github.com/gillianpalhano/printer-ppla,
// Argox OS-214plus'ta çalıştığı beyan edilen sendGraphic/addGraphic/deleteGraphic) —
// UYDURULMADI. AMA bizim tarafımızdan FİZİKSEL DOĞRULANMADI: `<STX>I` char dizisi
// (defaultSaveGraphic+memory+flip), koordinat birimi (1/100 inç mi dot mu) ve flip
// yönü sahada teyit edilmeli. Bu yüzden PPLA_RASTER_VERIFIED=false → fırlatır → registry
// komut moduna düşer (PPLA cihaz bugünkü komutla basar). F6 fiziksel testten sonra (önce
// hurda etikete bas, ters/ayna kontrol et) bayrağı true yap. Bkz. argox-ppla-spec memory.
//
// Komut dizisi (printer-ppla build.ts sırası, inç modu — emitCanvasPpla ile aynı):
//   <STX>n<CR>                        birim (inç)
//   [<STX>KI7{0|1}<CR>]               ribon (mediaType)
//   <STX>M{maxLen4}<CR>               TOF arama tavanı
//   <STX>ICCB{name}<CR>{BMP}          grafik İNDİR (C=RAM default; 8-bit mono BMP; B=flipped)
//   <STX>L<CR> D11<CR> H10<CR>        etiket formatı başı + piksel boyutu + ısı
//   1Y11000{yyyy}{xxxx}{name}<CR>     grafik YERLEŞTİR (sol-alt origin, 0,0)
//   Q{copies4}<CR> E<CR>              adet + bas
//   <STX>xCG{name}<CR>               grafik SİL (bellek temizle)
// =============================================================================

import { encodeBmp1 } from "./raster-bmp";
import { mmToDots, clampCopies, mediaTypeCommand } from "../native-label.shared";
import type { Bitmap1 } from "./raster-bitmap";
import type { ResolvedLabelFormat } from "../label-format.resolver";

const STX = "\x02";
/** Grafik bellek adı (≤16 karakter — printer-ppla limiti). */
const GRAPHIC_NAME = "TEKSLBL";

/** ⚠ PPLA raster fiziksel testte doğrulanana dek KAPALI. false → fırlatır → registry
 *  komut moduna düşer (güvenli). F6'da hurda etikete basıp doğrulandıktan sonra true yap. */
export const PPLA_RASTER_VERIFIED = false;

export class PplaRasterUnsupportedError extends Error {
  constructor() {
    super("PPLA raster grafik komutu henüz fiziksel doğrulanmadı (F0/F6 bekliyor)");
    this.name = "PplaRasterUnsupportedError";
  }
}

function pad4(n: number): string {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

export function wrapPplaRaster(bmp: Bitmap1, format: ResolvedLabelFormat, copies: number): Buffer {
  // Doğrulanmadıkça komuta düş (registry try/catch yakalar).
  if (!PPLA_RASTER_VERIFIED) throw new PplaRasterUnsupportedError();

  const dpi = format.dpi || 203;
  // DPL inç modunda koordinat/uzunluk alanları 1/100 İNÇ (emitCanvasPpla u() ile aynı).
  const u = (mm: number) => Math.round((mmToDots(mm, dpi) * 100) / dpi);
  const bmpBytes = encodeBmp1(bmp); // 8-bit mono BMP (BM + bitCount=1) — printer-ppla doğrular
  const mc = mediaTypeCommand(format.language, format.mediaType); // <STX>KI7{0|1} (boş → "")

  // Preamble (birim + ribon + TOF tavanı) — <STX>L'DEN ÖNCE (grafik indirme preCommand).
  const preamble = Buffer.from(
    `${STX}n\r` +
      (mc ? `${mc}\r` : "") +
      `${STX}M${pad4(u(format.heightMm + format.gapMm) + 50)}\r`,
    "latin1",
  );
  // Grafik İNDİR: <STX>I{cfg='C'}{memory='C'}{'B'=flipped}{name}<CR> + ham BMP baytları.
  const download = Buffer.concat([Buffer.from(`${STX}ICCB${GRAPHIC_NAME}\r`, "latin1"), bmpBytes]);
  // Etiket gövdesi: format başı + grafik YERLEŞTİR (sol-alt origin, 0,0) + bas.
  const body = Buffer.from(
    `${STX}L\r` +
      "D11\r" +
      "H10\r" +
      `1Y11000${pad4(0)}${pad4(0)}${GRAPHIC_NAME}\r` +
      `Q${pad4(clampCopies(copies))}\r` +
      "E\r",
    "latin1",
  );
  // Grafik SİL (bellek temizle) — postCommand.
  const del = Buffer.from(`${STX}xCG${GRAPHIC_NAME}\r`, "latin1");

  return Buffer.concat([preamble, download, body, del]);
}
