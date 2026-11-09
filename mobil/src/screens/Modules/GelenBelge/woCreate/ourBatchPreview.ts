// Seri kipinde "Bizim parti no" salt okunur alanı: numara kayıtta doğar; önizleme yalnız TAHMİNDİR (arada açılan parti
// kaydırır) — metin "sıradaki" der, söz vermez. Önizleme yoksa (çevrimdışı / hata / kısa rejim kapalı) yalnız "Otomatik".
import type { BatchNumberState } from '../../../../services/batch.service';

export function ourBatchAutoText(code: string | null | undefined): string {
  return code ? `Otomatik · sıradaki: ${code}` : 'Otomatik';
}

/** Sunucu yanıtından ardışık tahminler: yeni sunucu `nextCodes`, eski sunucu yalnız `nextCode` (ilk parti). */
export function previewCodes(s: BatchNumberState | null | undefined): readonly string[] {
  if (!s?.enabled) return [];
  if (s.nextCodes?.length) return s.nextCodes;
  return s.nextCode ? [s.nextCode] : [];
}
