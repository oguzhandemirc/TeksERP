// Belge masası otomatik çekim döngüsü (K26, deneysel): ayarlı aralıkla düşük kaliteli ara kare → `stepAutoCapture` →
// gerekirse tam çekim. expo-camera 17 Android'de her ara kare önbelleğe küçük bir dosya yazar (dosyasız yol boyut
// vermez); bu yüzden masa uzun süre boş kalınca döngü DURAKLAR, ekrana dokununca sürer.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { afterManualCapture, CALIBRATING_HINT, initialAutoState, rearm, resumeAutoState, resumeHint, stepAutoCapture, type AutoCaptureState } from './autoCapture';

/** Bu süre boyunca çekim/kağıt yoksa döngü duraklar (pil, ısı, önbellek). */
export const AUTO_IDLE_PAUSE_MS = 2 * 60_000;

interface Opts {
  enabled: boolean;
  intervalMs: number;
  /** Ara kare boyu (bayt); kamera meşgul/hazır değilse null. */
  probe: () => Promise<number | null>;
  onCapture: () => void;
  /** Kamerayı söken üst bileşenin tuttuğu durum (inceleme sonrası boş masa referansı kaybolmasın); yoksa yerel. */
  stateRef?: MutableRefObject<AutoCaptureState>;
}

export function useAutoCapture({ enabled, intervalMs, probe, onCapture, stateRef }: Opts) {
  const local = useRef<AutoCaptureState>(initialAutoState());
  const state = stateRef ?? local;
  const lastActivity = useRef(Date.now());
  const onCaptureRef = useRef(onCapture);
  onCaptureRef.current = onCapture;
  // Mount = kameraya dönüş: referans korunur, eski ara kareler atılır (idempotent; tek sefer).
  const [hint, setHint] = useState(() => {
    state.current = resumeAutoState(state.current);
    return resumeHint(state.current);
  });
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
  }, [enabled, paused, intervalMs, probe, state]);

  const resume = useCallback(() => {
    lastActivity.current = Date.now();
    setPaused(false);
  }, []);
  const markManual = useCallback(() => {
    state.current = afterManualCapture(state.current);
    lastActivity.current = Date.now();
  }, [state]);
  const retake = useCallback(() => {
    state.current = rearm(state.current);
    resume();
  }, [resume, state]);
  const recalibrate = useCallback(() => {
    state.current = initialAutoState();
    setHint(CALIBRATING_HINT);
    resume();
  }, [resume, state]);

  return { hint: paused ? 'Otomatik çekim duraklatıldı — sürdürmek için dokunun' : hint, paused, resume, markManual, retake, recalibrate };
}
