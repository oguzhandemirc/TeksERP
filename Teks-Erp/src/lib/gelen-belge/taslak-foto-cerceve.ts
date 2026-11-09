// Taslak satır kutularını okuma servisinin dikleştirdiği çerçeveden saklanan fotoğrafın çerçevesine çevirir (taslak.ts'ten ayrıldı).
import { rectToPhotoFrame } from "./sayfa-yonu";
import type { DraftLine } from "./taslak";

// Çerçeve dönüşümünün TEK KAYNAĞI `sayfa-yonu.ts` (canlı okuma eğim düzeltmesiyle aynı dönüşüm); burada yeniden dışa açılır.
export { rectToPhotoFrame, photoFrameSize } from "./sayfa-yonu";

export function linesToPhotoFrame(lines: DraftLine[], ocr: { rotation?: number; imageWidth: number; imageHeight: number }): DraftLine[] {
  if (!ocr.rotation) return lines;
  return lines.map((l) => ({
    ...l,
    sourceRects: Object.fromEntries(Object.entries(l.sourceRects).map(([k, r]) => [k, rectToPhotoFrame(r, ocr.rotation, ocr.imageWidth, ocr.imageHeight)])),
  }));
}
