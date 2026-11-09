// Ana veri eşlemesinin OCR'a dayanıklı eşitliği (saf, 2026-11-09): katlanmış iki adın boşluk/noktalama atılmış ve OCR
// karışıklıkları eşlenmiş anahtarı aynıysa ("HH1 MC" ≡ "HHL MC") benzerlik `OCR_EQUAL_SCORE` sayılır. Puan öneri
// eşiğini (0,90) geçer ama sahip "çok güçlü" eşiğinin (0,95) altındadır: sessiz atama yok, iki aday çıkarsa liste.
import { ocrCanonicalKey } from "./ocr-name-candidate.helper";

export const OCR_EQUAL_SCORE = 0.92;
/** Kısa anahtar her şeye denk düşer; altında eşitlik sayılmaz. */
const MIN_KEY_CHARS = 3;

/** Saf: katlanmış adın OCR anahtarı (harf/rakam dışı atılır). */
export function ocrMatchKey(folded: string): string {
  return ocrCanonicalKey(folded.replace(/[^a-z0-9]+/g, ""));
}

/** Saf: iki katlanmış ad OCR anahtarında eşitse `OCR_EQUAL_SCORE`, değilse 0. */
export function ocrEqualScore(aFolded: string, bFolded: string): number {
  const a = ocrMatchKey(aFolded);
  return a.length >= MIN_KEY_CHARS && a === ocrMatchKey(bFolded) ? OCR_EQUAL_SCORE : 0;
}
