// Tek uçuş kilidi — `isPending` bir sonraki render'a kadar false kalır; aynı olay döngüsündeki
// çift tık iki POST atardı (clientToken'sız uçlarda kopya belge riski). Ref senkron kilitler.
import { useRef } from "react";

export function useSingleFlight() {
  const busy = useRef(false);
  /** `start(done)`: kilit boşsa çalıştırır; işi bitiren `done()` çağırır (onSettled). */
  return (start: (done: () => void) => void) => {
    if (busy.current) return;
    busy.current = true;
    start(() => {
      busy.current = false;
    });
  };
}
