// Salon TV'si için tam ekran kipi: sayfa kökü pencereyi kaplar, tarayıcı/Electron
// tam ekranı denenir (izin yoksa kip yine çalışır). Esc ya da tam ekrandan çıkış kapatır.
// TV kipi (`locked`): açılışta tam ekran, çıkışı `TvExit` taşır; tarayıcı kullanıcı dokunuşu
// istediği için gerçek tam ekran ilk dokunuşta/tuşta yeniden denenir.
import { useCallback, useEffect, useState } from "react";

export function useFullscreen(root: HTMLElement | null, { locked = false }: { locked?: boolean } = {}) {
  const [active, setActive] = useState(locked);

  useEffect(() => {
    if (!locked || !root) return;
    // Esc TV kipinden çıkış tuşudur — tam ekranı yeniden istemez.
    const tryEnter = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key === "Escape") return;
      if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => undefined);
    };
    if (!document.fullscreenElement) root.requestFullscreen?.().catch(() => undefined);
    window.addEventListener("pointerdown", tryEnter);
    window.addEventListener("keydown", tryEnter);
    return () => {
      window.removeEventListener("pointerdown", tryEnter);
      window.removeEventListener("keydown", tryEnter);
    };
  }, [locked, root]);

  const enter = useCallback(() => {
    setActive(true);
    root?.requestFullscreen?.().catch(() => undefined);
  }, [root]);

  const exit = useCallback(() => {
    setActive(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!active || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[data-ui-sheet], [role=dialog]")) setActive(false);
    };
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) setActive(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, [active, locked]);

  return { active, enter, exit };
}
