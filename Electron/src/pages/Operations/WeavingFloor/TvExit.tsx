// TV kipinden GÖRÜNÜR çıkış: köşe düğmesi fare oynayınca belirir, boşta kalınca söner (TV'de
// ekranı kirletmesin); ilk açılışta birkaç saniye ipucuyla görünür; Esc her an çıkar.
import { useCallback, useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export const TV_EXIT_INTRO_MS = 6_000;
export const TV_EXIT_IDLE_MS = 3_000;

export function useTvExit(onExit: () => void): { visible: boolean; intro: boolean; show: () => void } {
  const [visible, setVisible] = useState(true);
  const [intro, setIntro] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideAfter = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setVisible(false);
      setIntro(false);
    }, ms);
  }, []);

  const show = useCallback(() => {
    setVisible(true);
    hideAfter(TV_EXIT_IDLE_MS);
  }, [hideAfter]);

  useEffect(() => {
    hideAfter(TV_EXIT_INTRO_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hideAfter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onExit();
    };
    // Tarayıcı ilk Esc'i tam ekrandan çıkmaya harcar (sayfaya ulaşmaz): düğme ipucuyla yeniden görünür.
    const onFullscreen = () => {
      if (document.fullscreenElement) return;
      setVisible(true);
      setIntro(true);
      hideAfter(TV_EXIT_INTRO_MS);
    };
    window.addEventListener("pointermove", show);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      window.removeEventListener("pointermove", show);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [onExit, show, hideAfter]);

  return { visible, intro, show };
}

interface Props {
  onExit: () => void;
  /** Düğme metni — ayrı pencerede "Pencereyi kapat". */
  label: string;
}

export function TvExitControl({ onExit, label }: Props) {
  const { visible, intro, show } = useTvExit(onExit);
  return (
    <div
      className={cn(
        "absolute right-4 top-4 z-[65] flex flex-col items-end gap-1.5 text-base transition-opacity duration-300",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      data-testid="tv-exit"
      data-visible={visible ? "1" : "0"}
    >
      <button
        type="button"
        onClick={onExit}
        onFocus={show}
        className="inline-flex items-center gap-2 rounded-full border bg-popover px-4 py-2 font-semibold text-popover-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {label}
        <kbd className="rounded border px-1.5 text-xs font-medium text-muted-foreground">Esc</kbd>
      </button>
      {intro && (
        <span className="rounded-md bg-popover/90 px-2.5 py-1 text-sm text-muted-foreground shadow" role="status">
          Fareyi oynatınca bu düğme yeniden görünür; Esc ile de çıkılır.
        </span>
      )}
    </div>
  );
}
