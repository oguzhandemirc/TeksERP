// Salon TV'si için tam ekran kipi: sayfa kökü pencereyi kaplar, tarayıcı/Electron
// tam ekranı denenir (izin yoksa kip yine çalışır). Esc ya da tam ekrandan çıkış kapatır.
import { useCallback, useEffect, useState } from "react";

export function useFullscreen(root: HTMLElement | null) {
  const [active, setActive] = useState(false);

  const enter = useCallback(() => {
    setActive(true);
    root?.requestFullscreen?.().catch(() => undefined);
  }, [root]);

  const exit = useCallback(() => {
    setActive(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!active) return;
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
  }, [active]);

  return { active, enter, exit };
}
