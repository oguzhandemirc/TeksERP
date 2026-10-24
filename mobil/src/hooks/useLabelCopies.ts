import { useCallback, useRef } from 'react';
import { useFeatureFlags } from './useFeatureFlags';
import { useSessionStore } from '../store/sessionStore';
import { useLabelCopiesStore } from '../store/labelCopiesStore';
import {
  defaultLabelCopies,
  labelCopiesEnabled,
  stepLabelCopies,
} from '../lib/labelCopies';

export interface LabelCopiesControl {
  /** STATION modu — seçici çizilir, istek `copies` taşır. */
  enabled: boolean;
  /** Seçicide görünen adet (override ya da istasyon/genel varsayılan). */
  count: number;
  inc: () => void;
  dec: () => void;
  /** Baskı anında çağrılır: STATION'da adedi döndürür ve seçiciyi varsayılana
   *  sıfırlar; GLOBAL'de `undefined` (istek adet taşımaz — bugünkü davranış). */
  take: () => number | undefined;
}

export function useLabelCopies(): LabelCopiesControl {
  const flags = useFeatureFlags().data;
  const station = useSessionStore((s) => s.active?.station ?? null);
  const override = useLabelCopiesStore((s) => s.override);

  const enabled = labelCopiesEnabled(flags?.labelCopiesSource);
  const stationId = station?.id ?? null;
  const base = defaultLabelCopies(station?.defaultLabelCopies, flags?.labelCopies);
  const count = override && override.stationId === stationId ? override.value : base;

  // take() mutation geri çağrılarında (eski render kapanışı) da GÜNCEL değeri okusun.
  const live = useRef({ enabled, stationId, count });
  live.current = { enabled, stationId, count };

  const inc = useCallback(() => {
    const l = live.current;
    useLabelCopiesStore.getState().setOverride(l.stationId, stepLabelCopies(l.count, 1));
  }, []);
  const dec = useCallback(() => {
    const l = live.current;
    useLabelCopiesStore.getState().setOverride(l.stationId, stepLabelCopies(l.count, -1));
  }, []);
  const take = useCallback((): number | undefined => {
    const l = live.current;
    if (!l.enabled) return undefined;
    useLabelCopiesStore.getState().reset();
    return l.count;
  }, []);

  return { enabled, count, inc, dec, take };
}
