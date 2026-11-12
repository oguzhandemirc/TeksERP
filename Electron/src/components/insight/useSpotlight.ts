import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Spot ışığı: bir bölümü SÜZMEDEN öne çıkarır — oraya kayar, bölümü vurgular, kardeşlerini geçici soldurur.
// Modal değildir: soluk alanlar tıklanabilir kalır; süre, Esc, başka tıklama ya da kullanıcı kaydırması bitirir.

export const SPOTLIGHT_DEFAULT_MS = 2800;

/** Bölüm durumu: `lit` vurgulu, `dim` soluk, `null` ışık yokken normal. */
export type SpotlightState = "lit" | "dim" | null;

export interface SpotlightOptions {
  /** Vurgu süresi (ms). */
  durationMs?: number;
}

export interface SpotlightRegionProps {
  ref: (el: HTMLElement | null) => void;
  "data-spotlight": "lit" | "dim" | undefined;
}

export interface SpotlightController {
  /** Vurgulanan bölüm anahtarı (yoksa `null`). */
  activeKey: string | null;
  /** Bölümü öne çıkarır; bölüm çizili değilse `false` döner (ışık yakılmaz, yalnız duyuru). */
  spotlight: (key: string, announce: string, missingText?: string) => boolean;
  clear: () => void;
  stateOf: (key: string) => SpotlightState;
  /** Öne çıkarılabilir bölümün kökü — `ref` + `data-spotlight` (görünüm `spotlightClass`tan). */
  regionProps: (key: string) => SpotlightRegionProps;
  /** Solabilir ama hiç vurgulanmayan kutu (ör. analiz şeridi). */
  dimProps: () => { "data-spotlight": "dim" | undefined };
  /** `aria-live` metni. */
  liveText: string;
}

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Odak hedefi: bölümdeki `[data-spotlight-heading]`, yoksa bölümün kendisi (programatik odak için tabIndex -1). */
function focusTarget(region: HTMLElement): HTMLElement {
  const heading = region.querySelector<HTMLElement>("[data-spotlight-heading]") ?? region;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  return heading;
}

export function useSpotlight({ durationMs = SPOTLIGHT_DEFAULT_MS }: SpotlightOptions = {}): SpotlightController {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const regions = useRef(new Map<string, HTMLElement>());
  const refCbs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const clear = useCallback(() => {
    stopTimer();
    setActiveKey(null);
  }, []);

  const spotlight = useCallback((key: string, announce: string, missingText?: string) => {
    const el = regions.current.get(key);
    if (!el) {
      clear();
      setLiveText(missingText ?? announce);
      return false;
    }
    stopTimer();
    setActiveKey(key);
    setLiveText(announce);
    el.scrollIntoView?.({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    focusTarget(el).focus({ preventScroll: true });
    timer.current = setTimeout(() => {
      timer.current = null;
      setActiveKey(null);
    }, durationMs);
    return true;
  }, [clear, durationMs]);

  // Kullanıcı niyeti ışığı söndürür. `scroll` olayı DİNLENMEZ: yumuşak kaydırmanın kendisi de onu üretir.
  useEffect(() => {
    if (activeKey === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || SCROLL_KEYS.has(e.key)) clear();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("wheel", clear, { passive: true });
    document.addEventListener("touchmove", clear, { passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("wheel", clear);
      document.removeEventListener("touchmove", clear);
    };
  }, [activeKey, clear]);

  useEffect(() => stopTimer, []);

  const regionRef = useCallback((key: string) => {
    let cb = refCbs.current.get(key);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) regions.current.set(key, el);
        else regions.current.delete(key);
      };
      refCbs.current.set(key, cb);
    }
    return cb;
  }, []);

  return useMemo<SpotlightController>(() => {
    const stateOf = (key: string): SpotlightState => (activeKey === null ? null : activeKey === key ? "lit" : "dim");
    return {
      activeKey,
      spotlight,
      clear,
      stateOf,
      regionProps: (key) => ({ ref: regionRef(key), "data-spotlight": stateOf(key) ?? undefined }),
      dimProps: () => ({ "data-spotlight": activeKey === null ? undefined : "dim" }),
      liveText,
    };
  }, [activeKey, spotlight, clear, regionRef, liveText]);
}
