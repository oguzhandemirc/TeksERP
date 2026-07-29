// =============================================================================
// Raster orkestratör — kanvas layout → bitmap → dil zarfı (bytes)
// =============================================================================
// registry (label-renderer.registry) ve önizleme (getRollPreview/getCanvasPreview)
// buraya delege eder. bytes = yazıcıya gidecek zarf; bitmap = önizleme BMP'si için.
// =============================================================================

import { PrinterLanguage } from "@prisma/client";
import type { CanvasRenderInput } from "../label-canvas-native.helper";
import { Bitmap1 } from "./raster-bitmap";
import { rasterizeCanvasLayout } from "./raster-canvas";
import { wrapPplbRaster } from "./raster-envelope-pplb";
import { wrapZplRaster } from "./raster-envelope-zpl";
import { wrapPplaRaster } from "./raster-envelope-ppla";

export type RasterLanguage = "PPLA" | "PPLB" | "ZPL";

/** Bu dil raster'lanabilir mi? (RASTER_HTML → hayır, kendi HTML hattı var.) */
export function isRasterLanguage(l: PrinterLanguage): boolean {
  return l === PrinterLanguage.PPLA || l === PrinterLanguage.PPLB || l === PrinterLanguage.ZPL;
}

/** Kanvas layout'u rasterize + dil zarfına sar. bytes = gönderilecek; bitmap =
 *  önizleme için (aynı piksel → önizleme=baskı). PPLA zarfı F0'a dek fırlatır.
 *  ASYNC (2026-07 icon): rasterizeCanvasLayout async oldu. */
export async function renderCanvasRaster(
  language: RasterLanguage,
  input: CanvasRenderInput,
): Promise<{ bytes: Buffer; bitmap: Bitmap1 }> {
  const bitmap = await rasterizeCanvasLayout(input);
  let bytes: Buffer;
  if (language === "PPLB") bytes = wrapPplbRaster(bitmap, input.format, input.copies);
  else if (language === "ZPL") bytes = wrapZplRaster(bitmap, input.format, input.copies);
  else bytes = wrapPplaRaster(bitmap, input.format, input.copies);
  return { bytes, bitmap };
}
