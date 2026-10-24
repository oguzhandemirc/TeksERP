// =============================================================================
// Etiket adedi seçicisi — SAF mantık (2026-10-24)
// =============================================================================
// Sunucu ayarı `labelCopiesSource`:
//   GLOBAL  (varsayılan) → seçici GÖRÜNMEZ, istek `copies` TAŞIMAZ (bugünkü ekran;
//                          sunucu genel adedi basar).
//   STATION → baskı düğmesinin yanında "– N +" (1–5); başlangıç istasyon
//             varsayılanı, o yoksa genel adet; her baskıdan sonra başlangıca döner.
// Sunucu tarafı tek çözücü: Teks-Erp `services/helpers/label-copies.helper.ts`.
// =============================================================================

export const LABEL_COPIES_MIN = 1;
/** Backend `LABEL_COPIES_MAX` aynası — dışı STATION modunda 400 döner. */
export const LABEL_COPIES_MAX = 5;
/** Sunucu genel adedi hiç bildirmediyse (eski sunucu) — backend kod varsayılanı. */
const FALLBACK_COUNT = 2;

function isValid(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= LABEL_COPIES_MIN && n <= LABEL_COPIES_MAX;
}

/** Seçici yalnız STATION modunda var; bilinmeyen/eksik değer = GLOBAL (fail-closed: bugünkü ekran). */
export function labelCopiesEnabled(source: string | null | undefined): boolean {
  return source === 'STATION';
}

export function clampLabelCopies(n: number): number {
  if (!Number.isFinite(n)) return LABEL_COPIES_MIN;
  return Math.max(LABEL_COPIES_MIN, Math.min(LABEL_COPIES_MAX, Math.floor(n)));
}

/** Seçicinin başlangıcı: istasyon varsayılanı > genel adet > 2 (sunucunun çözüm sırasıyla aynı). */
export function defaultLabelCopies(stationDefault: number | null | undefined, globalCount: number | null | undefined): number {
  if (isValid(stationDefault)) return stationDefault;
  if (isValid(globalCount)) return globalCount;
  return FALLBACK_COUNT;
}

export function stepLabelCopies(current: number, delta: 1 | -1): number {
  return clampLabelCopies(current + delta);
}

/** Baskı düğmesi metnine eklenen "×N" — seçici kapalıyken boş (metin bugünküyle aynı). */
export function labelCopiesSuffix(enabled: boolean, count: number): string {
  return enabled ? ` ×${count}` : '';
}
