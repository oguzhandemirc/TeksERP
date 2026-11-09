// Seri kipinde "Bizim parti no" salt okunur alanı: numara kayıtta doğar; önizleme yalnız TAHMİNDİR (arada açılan parti
// kaydırır) — kısa "Otomatik · X" tahmindir, söz vermez. Önizleme yoksa (çevrimdışı / hata / kısa rejim kapalı) yalnız "Otomatik".
import type { BatchNumberState } from '../../../../services/batch.service';

export function ourBatchAutoText(code: string | null | undefined): string {
  return code ? `Otomatik · ${code}` : 'Otomatik';
}

/** Sunucu yanıtından ardışık tahminler: yeni sunucu `nextCodes`, eski sunucu yalnız `nextCode` (ilk parti). */
export function previewCodes(s: BatchNumberState | null | undefined): readonly string[] {
  if (!s?.enabled) return [];
  if (s.nextCodes?.length) return s.nextCodes;
  return s.nextCode ? [s.nextCode] : [];
}

/**
 * Çok partide kaç numara tahmin edilir ve nereye yazılır: SINGLE = tek İE → TEK numara (formun üstünde bir kez);
 * PER_PARTY = açılmamış her parti ayrı İE → parti sayısı kadar ardışık tahmin (sekme başına). Hiç açılacak yoksa 0.
 */
export function batchPreviewPlan(mode: 'SINGLE' | 'PER_PARTY', pendingBlockNos: readonly number[]): { count: number; perParty: boolean } {
  if (pendingBlockNos.length === 0) return { count: 0, perParty: mode === 'PER_PARTY' };
  return mode === 'PER_PARTY' ? { count: pendingBlockNos.length, perParty: true } : { count: 1, perParty: false };
}
