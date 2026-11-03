// Belge masası otomatik çekim döngüsü (K26, deneysel): ayarlı aralıkla düşük kaliteli ara kare → `stepAutoCapture` →
// gerekirse tam çekim. expo-camera 17 Android'de her ara kare önbelleğe küçük bir dosya yazar (dosyasız yol boyut
// vermez); bu yüzden masa uzun süre boş kalınca döngü DURAKLAR, ekrana dokununca sürer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { afterManualCapture, initialAutoState, rearm, stepAutoCapture, type AutoCaptureState } from './autoCapture';

/** Bu süre boyunca çekim/kağıt yoksa döngü duraklar (pil, ısı, önbellek). */
export const AUTO_IDLE_PAUSE_MS = 2 * 60_000;

interface Opts {
  enabled: boolean;
  intervalMs: number;
  /** Ara kare boyu (bayt); kamera meşgul/hazır değilse null. */
  probe: () => Promise<number | null>;
  onCapture: () => void;
}

export function useAutoCapture({ enabled, intervalMs, probe, onCapture }: Opts) {
  const state = useRef<AutoCaptureState>(initialAutoState());
  const lastActivity = useRef(Date.now());
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  const [hint, setHint] = useState('Boş masa referansı alınıyor — masayı boş bırakın');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!enabled || paused) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const size = await probe().catch(() => null);
      if (!alive) return;
      if (size !== null) {
        const d = stepAutoCapture(state.current, size);
        state.current = d.state;
        setHint(d.hint);
        if (!d.idle) lastActivity.current = Date.now();
        if (d.action === 'capture') onCaptureRef.current();
        if (Date.now() - lastActivity.current > AUTO_IDLE_PAUSE_MS) {
          setPaused(true);
          return;
        }
      }
      timer = setTimeout(() => void tick(), intervalMs);
    };
    timer = setTimeout(() => void tick(), intervalMs);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, paused, intervalMs, probe]);

  const resume = useCallback(() => {
    lastActivity.current = Date.now();
    setPaused(false);
  }, []);
  const markManual = useCallback(() => {
    state.current = afterManualCapture(state.current);
    lastActivity.current = Date.now();
  }, []);
  const retake = useCallback(() => {
    state.current = rearm(state.current);
    resume();
  }, [resume]);
  const recalibrate = useCallback(() => {
    state.current = initialAutoState();
    setHint('Boş masa referansı alınıyor — masayı boş bırakın');
    resume();
  }, [resume]);

  return { hint: paused ? 'Otomatik çekim duraklatıldı — sürdürmek için dokunun' : hint, paused, resume, markManual, retake, recalibrate };
}
