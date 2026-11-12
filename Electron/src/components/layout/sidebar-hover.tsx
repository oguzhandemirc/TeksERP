import { createContext, useCallback, useContext, useEffect, useRef, useState, type FocusEvent, type PointerEvent } from "react";

export const HOVER_OPEN_DELAY_MS = 120;
export const HOVER_CLOSE_DELAY_MS = 200;

/** Bağlam menüsü gibi menü DIŞINA taşan açık yüzeyler, açıkken geçici açılışı tutar. */
export const SidebarHoldCtx = createContext<(held: boolean) => void>(() => {});
export const useSidebarHold = () => useContext(SidebarHoldCtx);

const isTouchLike = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";

/**
 * Daraltılmış kenar menünün GEÇİCİ açılışı (fare üstünde ya da klavye odağında). Kalıcı tercihi
 * yazmaz; yalnız fare imleciyle (dokunmatik/kalem hover üretmez) ve `enabled` iken çalışır.
 */
export function useSidebarHoverExpand(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const state = useRef({ hover: false, focus: false, holds: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settle = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const s = state.current;
      setOpen(s.hover || s.focus || s.holds > 0);
    }, delay);
  }, []);
  const wanted = () => state.current.hover || state.current.focus || state.current.holds > 0;
  const update = () => settle(wanted() ? HOVER_OPEN_DELAY_MS : HOVER_CLOSE_DELAY_MS);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  useEffect(() => {
    if (enabled) return;
    state.current = { hover: false, focus: false, holds: 0 };
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, [enabled]);

  const hold = useCallback(
    (held: boolean) => {
      state.current.holds = Math.max(0, state.current.holds + (held ? 1 : -1));
      // Açık tutma anında; bırakınca fare hâlâ dışarıdaysa kapanış gecikmesiyle.
      settle(state.current.holds > 0 ? 0 : HOVER_CLOSE_DELAY_MS);
    },
    [settle],
  );

  const handlers = {
    onPointerEnter: (e: PointerEvent) => {
      if (!enabled || isTouchLike(e)) return;
      state.current.hover = true;
      update();
    },
    onPointerLeave: (e: PointerEvent) => {
      if (isTouchLike(e)) return;
      state.current.hover = false;
      update();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (!enabled) return;
      let visible = false;
      try {
        visible = e.target.matches(":focus-visible");
      } catch {
        /* eski motor: yalnız fare yolu */
      }
      if (!visible) return;
      state.current.focus = true;
      update();
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      state.current.focus = false;
      update();
    },
  };
  return { open: enabled && open, handlers, hold };
}
