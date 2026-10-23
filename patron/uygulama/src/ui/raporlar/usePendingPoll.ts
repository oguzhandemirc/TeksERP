// Bekleyen rapor isteği için ekran içi kısa yoklama: bulut rapor sonucu için değişim sayacını artırmaz (sanal ad yok),
// bu yüzden istek kesinleşene dek 3 → 6 → 10 → 20 sn aralıkla `reload`; en çok ~2 dk. Durum kesinleşince ya da ekran
// odaktan çıkınca durur; yeniden odakta (hâlâ bekliyorsa) baştan başlar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useScreenFocus } from "../../state/useScreenFocus";

/** Yoklama adımları (ms); toplam ≈ 119 sn. */
export const PENDING_POLL_MS: readonly number[] = [3_000, 6_000, 10_000, 20_000, 20_000, 20_000, 20_000, 20_000];

export function usePendingPoll(pending: boolean, reload: () => void): void {
  const focused = useRef(true);
  const [round, setRound] = useState(0);
  const first = useRef(true);
  useScreenFocus(
    useCallback(() => {
      focused.current = true;
      if (first.current) first.current = false;
      else setRound((r) => r + 1);
      return () => {
        focused.current = false;
      };
    }, []),
  );
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!pending) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const ms = PENDING_POLL_MS[i];
      if (ms === undefined) return;
      timer = setTimeout(() => {
        if (!focused.current) return;
        i += 1;
        reloadRef.current();
        step();
      }, ms);
    };
    step();
    return () => clearTimeout(timer);
  }, [pending, round]);
}
