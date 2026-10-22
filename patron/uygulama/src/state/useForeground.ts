// Uygulama ön planı (`AppState`): yalnız ön plandayken ağ döngüsü koşar (pil), öne gelince ekranlar ve oturum
// tazelenir. "background" dışındaki her durum ön plan sayılır (iOS "inactive" geçicidir; açılıştaki "unknown" önde).
import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export function isForeground(s: AppStateStatus | null | undefined | unknown): boolean {
  return s !== "background";
}

/** Uygulama arka plandan (ya da "inactive"ten) "active"e dönünce `onActive` çağrılır; ilk bağlanışta çağrılmaz. */
export function useForeground(onActive: () => void): void {
  const cb = useRef(onActive);
  cb.current = onActive;
  useEffect(() => {
    let prev: unknown = AppState.currentState;
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const was = prev;
      prev = next;
      if (next === "active" && was !== "active") cb.current();
    });
    return () => sub?.remove();
  }, []);
}

/** Ön planda mı (canlı): arka plana geçince false, dönünce true. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(() => isForeground(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => setActive(isForeground(next)));
    return () => sub?.remove();
  }, []);
  return active;
}
