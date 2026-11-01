// D4-E2b: "Ölçülen en (cm)" alanının durumu — top değişince sıfırlanır; değer yalnız
// GİRİLDİĞİ topun gövdesine eklenir (gramaj düzeltmesi önceki topa gider, ona eklenmez).
// D4-KUC3b: sınır dışı en (sunucunun `widthLimit`i) istek GİTMEDEN uyarılır.
import { useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import { measuredWidthLimitError, parseMeasuredWidth, withMeasuredWidth, type MeasuredWidthLimit } from './measuredWidth';

export interface MeasuredWidthState {
  enabled: boolean;
  text: string;
  setText: (t: string) => void;
  /** Seçili topun sunucu sınırı (yoksa ön-denetim yok). */
  limit: MeasuredWidthLimit | null;
  /** Gövdeye eni ekler; geçersiz ya da sınır dışı metinde null (istek GİTMEZ, Türkçe uyarı basılır). */
  attach: <T extends { rollId: string }>(vars: T) => T | null;
}

export function useMeasuredWidth(
  enabled: boolean,
  rollId: string | null,
  limit?: MeasuredWidthLimit | null,
): MeasuredWidthState {
  const [text, setText] = useState('');
  useEffect(() => setText(''), [rollId]);
  const attach = <T extends { rollId: string }>(vars: T): T | null => {
    if (!enabled || vars.rollId !== rollId) return vars;
    const parsed = parseMeasuredWidth(text);
    if (!parsed.ok) {
      Toast.show({ type: 'error', text1: 'Ölçülen en geçersiz', text2: parsed.message });
      return null;
    }
    const outOfRange = parsed.value == null ? null : measuredWidthLimitError(parsed.value, limit);
    if (outOfRange) {
      Toast.show({ type: 'error', text1: 'Ölçülen en sınır dışı', text2: outOfRange });
      return null;
    }
    return withMeasuredWidth(vars, parsed.value);
  };
  return { enabled, text, setText, limit: limit ?? null, attach };
}
