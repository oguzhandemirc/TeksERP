// Görüntüleyici hareketleri: tekerlek/pinch (imleç noktasına), sürükle-kaydır, iki parmak pinch, çift tık, klavye.
// Tekerlek dinleyicisi elle bağlanır: React'in onWheel'i pasif, sayfa kaymasını engelleyemez.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  fitScale,
  fitView,
  panBy,
  rotateView,
  wheelFactor,
  zoomAt,
  type Geo,
  type Pt,
  type Size,
  type View,
} from "./scanView";

export const KEY_ZOOM_STEP = 1.25;
const KEY_PAN_STEP = 60;

export type Step = (v: View) => View;
type Update = (fn: Step) => void;
interface GeoRef {
  nat: Size | null;
  vp: Size;
}

function localPoint(el: HTMLElement, clientX: number, clientY: number): Pt {
  const r = el.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

/** Klavye kısayolu → görünüm adımı (düğmeler de bunu kullanır); tanınmayan tuş undefined. */
export function keyStep(key: string, g: Geo): Step | undefined {
  const center = { x: g.vp.w / 2, y: g.vp.h / 2 };
  const pan =
    (x: number, y: number): Step =>
    (v) =>
      panBy(v, { x, y }, g);
  const zoom =
    (f: number): Step =>
    (v) =>
      zoomAt(v, f, center, g);
  const rotate: Step = (v) => rotateView(v, g.nat, g.vp);
  const map: Record<string, Step> = {
    "+": zoom(KEY_ZOOM_STEP),
    "=": zoom(KEY_ZOOM_STEP),
    "-": zoom(1 / KEY_ZOOM_STEP),
    "0": (v) => fitView(g.nat, g.vp, v.rot),
    r: rotate,
    R: rotate,
    ArrowLeft: pan(KEY_PAN_STEP, 0),
    ArrowRight: pan(-KEY_PAN_STEP, 0),
    ArrowUp: pan(0, KEY_PAN_STEP),
    ArrowDown: pan(0, -KEY_PAN_STEP),
  };
  return map[key];
}

/** Tek işaretçi: kaydır. İki parmak: uzaklık oranıyla orta noktaya zoom + orta noktanın kayması. */
function pointerStep(prev: Pt, cur: Pt, other: Pt | undefined, g: Geo): Step | undefined {
  if (!other) return (v) => panBy(v, { x: cur.x - prev.x, y: cur.y - prev.y }, g);
  const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
  if (d0 <= 0) return undefined;
  const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
  const mid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
  return (v) => panBy(zoomAt(v, d1 / d0, mid, g), { x: (cur.x - prev.x) / 2, y: (cur.y - prev.y) / 2 }, g);
}

function useWheelZoom(ref: RefObject<HTMLDivElement | null>, geo: RefObject<GeoRef>, update: Update) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { nat, vp } = geo.current;
      if (!nat) return;
      e.preventDefault();
      const at = localPoint(el, e.clientX, e.clientY);
      update((v) => zoomAt(v, wheelFactor(e.deltaY, e.deltaMode, e.ctrlKey), at, { nat, vp }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref, geo, update]);
}

export function useScanGestures(
  ref: RefObject<HTMLDivElement | null>,
  nat: Size | null,
  vp: Size,
  update: Update,
) {
  const geo = useRef<GeoRef>({ nat, vp });
  useLayoutEffect(() => {
    geo.current = { nat, vp };
  }, [nat, vp]);
  const pointers = useRef(new Map<number, Pt>());
  useWheelZoom(ref, geo, update);
  const current = (): Geo | null => (geo.current.nat ? { nat: geo.current.nat, vp: geo.current.vp } : null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, localPoint(e.currentTarget, e.clientX, e.clientY));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    const g = current();
    if (!prev || !g || ps.size > 2) return;
    const cur = localPoint(e.currentTarget, e.clientX, e.clientY);
    const other = [...ps.entries()].find(([id]) => id !== e.pointerId)?.[1];
    const step = pointerStep(prev, cur, other, g);
    if (step) update(step);
    ps.set(e.pointerId, cur);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    const g = current();
    if (!g) return;
    const at = localPoint(e.currentTarget, e.clientX, e.clientY);
    // Sığdır civarındaysa noktaya yaklaş, değilse sığdır.
    update((v) =>
      v.scale <= fitScale(g.nat, g.vp, v.rot) * 1.05 ? zoomAt(v, 2.5, at, g) : fitView(g.nat, g.vp, v.rot),
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const g = current();
    if (!g || e.ctrlKey || e.metaKey || e.altKey) return;
    const step = keyStep(e.key, g);
    if (!step) return;
    e.preventDefault();
    update(step);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onDoubleClick,
    onKeyDown,
  };
}
