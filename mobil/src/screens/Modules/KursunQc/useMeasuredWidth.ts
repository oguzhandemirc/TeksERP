// D4-E2b: "Ölçülen en (cm)" alanının durumu — top değişince sıfırlanır; değer yalnız
// GİRİLDİĞİ topun gövdesine eklenir (gramaj düzeltmesi önceki topa gider, ona eklenmez).
import { useEffect, useState } from 'react';
import Toast from 'react-native-toast-message';
import { parseMeasuredWidth, withMeasuredWidth } from './measuredWidth';

export interface MeasuredWidthState {
  enabled: boolean;
  text: string;
  setText: (t: string) => void;
  /** Gövdeye eni ekler; geçersiz metinde null (istek GİTMEZ, Türkçe uyarı basılır). */
  attach: <T extends { rollId: string }>(vars: T) => T | null;
}

export function useMeasuredWidth(enabled: boolean, rollId: string | null): MeasuredWidthState {
  const [text, setText] = useState('');
  useEffect(() => setText(''), [rollId]);
  const attach = <T extends { rollId: string }>(vars: T): T | null => {
    if (!enabled || vars.rollId !== rollId) return vars;
    const parsed = parseMeasuredWidth(text);
    if (!parsed.ok) {
      Toast.show({ type: 'error', text1: 'Ölçülen en geçersiz', text2: parsed.message });
      return null;
    }
    return withMeasuredWidth(vars, parsed.value);
  };
  return { enabled, text, setText, attach };
}
