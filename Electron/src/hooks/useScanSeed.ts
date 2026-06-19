import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Sekme `location.state[key]` içinde taşınan taranan kodu okuyup bir kez
 * `onSeed`'e verir (scan-anywhere overlay'i `openTab(path,{state})` ile gönderir;
 * hedef sayfa burada onu yakalayıp oto-aksiyon alır). Aynı state objesi için
 * tekrar tetiklemez (StrictMode çift-invoke güvenli); yeni navigasyon → yeni
 * state objesi → tekrar tetikler (aynı kod yeniden okutulabilir).
 */
export function useScanSeed(key: string, onSeed: (value: string) => void): void {
  const location = useLocation();
  const onSeedRef = useRef(onSeed);
  onSeedRef.current = onSeed;
  const lastStateRef = useRef<unknown>(Symbol("init"));

  useEffect(() => {
    if (location.state === lastStateRef.current) return;
    lastStateRef.current = location.state;
    const st = location.state as Record<string, unknown> | null;
    const val = st && typeof st[key] === "string" ? (st[key] as string) : null;
    if (val) onSeedRef.current(val);
  }, [location.state, key]);
}
