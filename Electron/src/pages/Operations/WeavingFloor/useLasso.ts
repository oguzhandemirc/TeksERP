// Sürükle-seç (lasso): kartların ARASINDAKİ boş alanda sol tuşla sürükleyince dikdörtgen çizilir,
// değen kartlar seçilir. Kart / hol başlığı / düğme üstünden başlamaz; dokunmatikte yoktur
// (kaydırmayla çakışır). Kenara gelince kaydırıcı kendiliğinden kayar.
import { useCallback, useEffect, useRef, useState } from "react";
import { boxOf, isDrag, lassoPick, type Box } from "./selection";

const EDGE_PX = 40;
const SCROLL_STEP = 14;

function scrollParentOf(el: HTMLElement | null): HTMLElement | null {
  for (let p = el; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function cardBoxes(root: HTMLElement | null): Array<{ id: string; box: Box }> {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>("[data-loom-id]")].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.loomId!, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  });
}

interface Opts {
  enabled: boolean;
  root: HTMLElement | null;
  /** Sürükleme bitti: değen kartlar + Ctrl/Cmd basılı mıydı (ekle). Kısa sürükleme = boşluğa tık (`picked` null). */
  onPick: (picked: string[] | null, add: boolean) => void;
}

export function useLasso({ enabled, root, onPick }: Opts): { box: Box | null; onPointerDown: (e: React.PointerEvent) => void } {
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<{ x: number; y: number; scrollTop0: number; scroller: HTMLElement | null; add: boolean; lastX: number; lastY: number } | null>(null);
  const raf = useRef<number | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  const update = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    const dy = (d.scroller?.scrollTop ?? 0) - d.scrollTop0;
    setBox(boxOf(d.x, d.y - dy, d.lastX, d.lastY));
  }, []);

  const tick = useCallback(() => {
    const d = drag.current;
    raf.current = null;
    if (!d?.scroller) return;
    const r = d.scroller.getBoundingClientRect();
    const step = d.lastY < r.top + EDGE_PX ? -SCROLL_STEP : d.lastY > r.bottom - EDGE_PX ? SCROLL_STEP : 0;
    if (step === 0) return;
    d.scroller.scrollTop += step;
    update();
    raf.current = requestAnimationFrame(tick);
  }, [update]);

  useEffect(() => {
    if (!enabled) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      if (!isDrag(d.x, d.y, e.clientX, e.clientY) && !box) return;
      update();
      if (raf.current === null) raf.current = requestAnimationFrame(tick);
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      const dy = (d.scroller?.scrollTop ?? 0) - d.scrollTop0;
      const dragged = isDrag(d.x, d.y - dy, e.clientX, e.clientY);
      setBox(null);
      pickRef.current(dragged ? lassoPick(boxOf(d.x, d.y - dy, e.clientX, e.clientY), cardBoxes(root)) : null, d.add);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [enabled, root, update, tick, box]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0 || e.pointerType === "touch") return;
      const t = e.target as HTMLElement;
      if (t.closest("[data-loom-id], [data-hall-header], button, a, input, [role=menu]")) return;
      const scroller = scrollParentOf(root);
      drag.current = { x: e.clientX, y: e.clientY, scrollTop0: scroller?.scrollTop ?? 0, scroller, add: e.ctrlKey || e.metaKey, lastX: e.clientX, lastY: e.clientY };
      e.preventDefault();
    },
    [enabled, root],
  );

  return { box, onPointerDown };
}
