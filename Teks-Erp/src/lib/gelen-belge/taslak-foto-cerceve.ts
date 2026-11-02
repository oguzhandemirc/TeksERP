// Taslak satır kutularını okuma servisinin dikleştirdiği çerçeveden saklanan fotoğrafın çerçevesine çevirir (taslak.ts'ten ayrıldı).
import type { OcrRect } from "./motor";
import type { DraftLine } from "./taslak";

/**
 * Okuma servisi yan dönük sayfayı dikleştirip okuduysa (`rotation`), satır kutuları saklanan FOTOĞRAFIN çerçevesine
 * geri çevrilir: panel kutuyu dönmemiş fotoğrafın üstüne çizer. Şablon ayrıştırma DİK çerçevede kalır (bu adımdan önce).
 */
export function rectToPhotoFrame(r: OcrRect, rotation: number | undefined, uprightW: number, uprightH: number): OcrRect {
  switch (rotation) {
    case 90:
      return { x: r.y, y: uprightW - (r.x + r.width), width: r.height, height: r.width };
    case 270:
      return { x: uprightH - (r.y + r.height), y: r.x, width: r.height, height: r.width };
    case 180:
      return { x: uprightW - (r.x + r.width), y: uprightH - (r.y + r.height), width: r.width, height: r.height };
    default:
      return r;
  }
}

export function linesToPhotoFrame(lines: DraftLine[], ocr: { rotation?: number; imageWidth: number; imageHeight: number }): DraftLine[] {
  if (!ocr.rotation) return lines;
  return lines.map((l) => ({
    ...l,
    sourceRects: Object.fromEntries(Object.entries(l.sourceRects).map(([k, r]) => [k, rectToPhotoFrame(r, ocr.rotation, ocr.imageWidth, ocr.imageHeight)])),
  }));
}
