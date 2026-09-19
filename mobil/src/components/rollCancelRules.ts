// =============================================================================
// TOP İPTAL MODALI — saf kurallar (bileşenden ayrı; testi DOM'suz).
// Sebep zorunluluğu YALNIZ sunucudan okunur (önizleme `reasonRequired` ya da 400 reddi) — bayrak tahmin edilmez.
// =============================================================================
import { CANCEL_MIN_REASON } from '../constants/cancelReasons';
import { isCancelReasonRequiredError, type RollCancelPreview } from '../services/roll.service';

/** Eski sunucu alanı göndermez, çevrimdışında önizleme yok → opsiyonel (bugünkü davranış). */
export function reasonRequiredOf(
  preview: Pick<RollCancelPreview, 'reasonRequired'> | null,
  offline: boolean,
): boolean {
  return !offline && preview?.reasonRequired === true;
}

/** Serbest metin yalnız anlamlıysa sebeptir; kısa doldurma sebepsiz sayılır (sunucuyla aynı alt sınır). */
export function typedReasonOf(text: string): string | undefined {
  const t = text.trim();
  return t.length >= CANCEL_MIN_REASON ? t : undefined;
}

/** Ana düğme: zorunlu kipte serbest metin yoksa kilitli. Chip'ler sebebi kendisi taşır, bu kilide girmez. */
export function mainConfirmLocked(a: { reasonRequired: boolean; typedReason: string | undefined }): boolean {
  return a.reasonRequired && !a.typedReason;
}

export interface CancelRejection {
  rollId: string;
  message: string;
}

export const CANCEL_REASON_FALLBACK_MESSAGE =
  'Top iptali için sebep zorunlu — katalogdan seçin ya da yazın.';

/** onError'da: sunucu "sebep zorunlu" dediyse modal o top için yeniden açılır; başka hata → null (toast yolu). */
export function cancelReasonRejection(err: unknown, rollId: string): CancelRejection | null {
  if (!isCancelReasonRequiredError(err)) return null;
  const message = (err as { message?: string }).message?.trim();
  return { rollId, message: message || CANCEL_REASON_FALLBACK_MESSAGE };
}
