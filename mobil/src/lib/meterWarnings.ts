import Toast from 'react-native-toast-message';

/**
 * Ölçüm yanıtının kökündeki `warnings` notlarını (D4-B5k: süresi geçmiş sayaç kalibrasyonu) gösterir.
 * Ekran başarı toast'ını yanıt döner dönmez basar ve aynı anda tek toast görünür; not onu silmesin diye
 * kısa gecikmeyle ARDINDAN gelir. Not yoksa hiçbir şey olmaz (eski sunucu alanı göndermez).
 */
export const METER_WARNING_DELAY_MS = 1500;

export function showMeterWarnings<T>(res: T): T {
  const warnings = (res as { warnings?: unknown } | null)?.warnings;
  if (!Array.isArray(warnings)) return res;
  const notes = warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '');
  if (notes.length === 0) return res;
  setTimeout(() => {
    Toast.show({ type: 'info', text1: 'Dikkat — sayaç', text2: notes.join('\n'), visibilityTime: 8000 });
  }, METER_WARNING_DELAY_MS);
  return res;
}
