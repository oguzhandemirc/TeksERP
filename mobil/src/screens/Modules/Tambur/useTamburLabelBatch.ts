// Tambur müşteri parti no — yapışkan değer + sayaç durumu (kararlar saf `labelBatch.ts`te).
import { useEffect, useState } from 'react';
import {
  initialLabelBatch,
  labelBatchBody,
  labelBatchStripParts,
  labelBatchStripText,
  labelBatchWarning,
  withScope,
  withAutoSeed,
  withUse,
  withValue,
  type LabelBatchState,
} from './labelBatch';

export interface TamburLabelBatch {
  enabled: boolean;
  value: string;
  setValue: (t: string) => void;
  /** Varsayılan değer (gelen belge partisi / İE'nin son değeri) — elle girilen değeri ezmez. */
  autoSeed: (seed: string | null | undefined) => void;
  /** Gövdeye giden değer (ayar kapalıysa undefined). */
  body: () => string | null | undefined;
  /** Başarılı kesimin gönderdiği değer → sayaç. */
  recordUse: (sent: string | null | undefined) => void;
  stripText: string;
  /** Şeritte büyük değer + küçük sayaç. */
  stripParts: { value: string | null; countText: string | null };
  warning: string | null;
}

export function useTamburLabelBatch(enabled: boolean, scopeKey: string | null): TamburLabelBatch {
  const [st, setSt] = useState<LabelBatchState>(() => initialLabelBatch(scopeKey));
  // Kapsam (iş emri / müşteri) değişince sıfır; null = ayar henüz yükleniyor → değer korunur.
  useEffect(() => {
    if (scopeKey != null) setSt((s) => withScope(s, scopeKey));
  }, [scopeKey]);
  return {
    enabled,
    value: st.value,
    setValue: (t) => setSt((s) => withValue(s, t)),
    autoSeed: (seed) => setSt((s) => withAutoSeed(s, seed)),
    body: () => labelBatchBody(enabled, st),
    recordUse: (sent) => setSt((s) => withUse(s, sent)),
    stripText: labelBatchStripText(st),
    stripParts: labelBatchStripParts(st),
    warning: labelBatchWarning(enabled, st),
  };
}
