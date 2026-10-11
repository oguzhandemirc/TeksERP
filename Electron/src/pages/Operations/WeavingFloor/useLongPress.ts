// Dokunmatikte uzun bas (~500 ms) = seçim kipine gir + o kartı seç. Parmak kayarsa (kaydırma) iptal.
// Uzun basıştan sonra gelen tık yutulur (kart yeniden çevrilmesin); sağ tık menüsü dokunmatikte
// açılmaz — karşılığı seçim çubuğundaki "⋯" düğmesidir.
import { useCallback, useEffect, useRef } from "react";

export const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;
/** Uzun basıştan sonra bu süre içinde gelen ilk tık yutulur. */
const CLICK_SUPPRESS_MS = 700;

interface Press {
  timer: ReturnType<typeof setTimeout>;
  x: number;
  y: number;
  fired: boolean;
}

interface Opts {
  enabled: boolean;
  onLongPress: (id: string) => void;
}

export interface LongPress {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerEnd: () => void;
  /** Son işaretçi dokunmatik miydi (sağ tık menüsü dokunmatikte açılmaz). */
  lastWasTouch: () => boolean;
  /** Uzun basışın ardından gelen tık mı? (true ise çağıran tıkı yok sayar) */
  consumeClick: () => boolean;
}

export function useLongPress({ enabled, onLongPress }: Opts): LongPress {
  const press = useRef<Press | null>(null);
  const lastTouch = useRef(false);
  const suppressUntil = useRef(0);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const cancel = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      lastTouch.current = e.pointerType === "touch";
      if (!enabled || !lastTouch.current) return;
      const id = (e.target as HTMLElement).closest<HTMLElement>("[data-loom-id]")?.dataset.loomId;
      if (!id) return;
      // Radix'in kendi dokunmatik uzun-bas menüsü (700 ms) başlamasın; kaydırma ve tık etkilenmez.
      e.preventDefault();
      cancel();
      const p: Press = { x: e.clientX, y: e.clientY, fired: false, timer: setTimeout(() => {
        p.fired = true;
        cb.current(id);
      }, LONG_PRESS_MS) };
      press.current = p;
    },
    [enabled, cancel],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = press.current;
      if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE_PX) {
        cancel();
        press.current = null;
      }
    },
    [cancel],
  );

  const onPointerEnd = useCallback(() => {
    const p = press.current;
    if (!p) return;
    cancel();
    press.current = null;
    if (p.fired) suppressUntil.current = Date.now() + CLICK_SUPPRESS_MS;
  }, [cancel]);

  const consumeClick = useCallback(() => {
    if (Date.now() >= suppressUntil.current) return false;
    suppressUntil.current = 0;
    return true;
  }, []);

  const lastWasTouch = useCallback(() => lastTouch.current, []);
  return { onPointerDown, onPointerMove, onPointerEnd, lastWasTouch, consumeClick };
}
