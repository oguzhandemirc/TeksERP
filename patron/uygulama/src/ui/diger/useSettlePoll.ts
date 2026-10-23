// Kısa yoklama: gelen kutusu mesajının durumu değişim akışında sayılmaz (sunucu sanal ad artırmaz), bu yüzden işlenmeyi
// bekleyen mesaj varken ekran KENDİ tazeler — 3 → 6 → 10 → 20 sn aralıkla, toplam ~2 dk. Durum kesinleşince, ekran
// odaktan çıkınca ya da uygulama arka plana düşünce durur; yeniden odakta bütçe baştan başlar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppActive } from "../../state/useForeground";
import { useScreenFocus } from "../../state/useScreenFocus";

/** Ardışık bekleme aralıkları (ms); toplam 119 sn. */
export const SETTLE_POLL_MS: readonly number[] = [3_000, 6_000, 10_000, 20_000, 20_000, 20_000, 20_000, 20_000];

export function useSettlePoll(active: boolean, reload: () => void, steps: readonly number[] = SETTLE_POLL_MS): void {
  const [focused, setFocused] = useState(true);
  const appActive = useAppActive();
  const step = useRef(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useScreenFocus(
    useCallback(() => {
      setFocused(true);
      step.current = 0;
      return () => setFocused(false);
    }, []),
  );

  const running = active && focused && appActive;
  useEffect(() => {
    if (!running) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const next = () => {
      const wait = steps[step.current];
      if (wait === undefined) return;
      timer = setTimeout(() => {
        step.current += 1;
        reloadRef.current();
        next();
      }, wait);
    };
    next();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [running, steps]);
}
