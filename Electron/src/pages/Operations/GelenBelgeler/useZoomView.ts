// Görüntüleyici durumu: görünüm ölçümü, sığdır, tam ekran (Escape), seçili satıra kaydırma.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { fitScale, fitView, focusBox, isBoxVisible, type Box, type Size, type View } from "./scanView";
import type { Step } from "./useScanGestures";

function useViewportSize(ref: RefObject<HTMLDivElement | null>): Size {
  const [vp, setVp] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setVp((p) =>
        p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return vp;
}

function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEscape();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

export function useZoomView(
  ref: RefObject<HTMLDivElement | null>,
  highlight: Box | null,
  selectionKey: string | null,
) {
  const vp = useViewportSize(ref);
  const [nat, setNat] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [full, setFull] = useState(false);
  const closeFull = useCallback(() => setFull(false), []);
  useEscape(full, closeFull);
  // Görünüm boyutu değişince (pencere, tam ekran) mevcut yönelimle yeniden sığdır.
  useEffect(() => {
    if (nat) setView((v) => fitView(nat, vp, v?.rot ?? 0));
  }, [nat, vp]);
  const update = useCallback((fn: Step) => setView((v) => (v ? fn(v) : v)), []);

  // Seçim değişti: yakınlaşılmış ve kutu görünmüyorsa ölçeği koruyarak kutuyu ortala.
  // Kutu nesnesi her çizimde yeni doğar; ref + değer anahtarı, elle kaydırmayı geri çekmemek için.
  const latest = useRef({ highlight, vp });
  useLayoutEffect(() => {
    latest.current = { highlight, vp };
  });
  const hlKey = highlight ? `${highlight.x},${highlight.y},${highlight.width},${highlight.height}` : "";
  useEffect(() => {
    const { highlight: b, vp: p } = latest.current;
    if (!nat || !b) return;
    update((v) =>
      v.scale > fitScale(nat, p, v.rot) * 1.01 && !isBoxVisible(v, nat, p, b)
        ? focusBox(v, { nat, vp: p }, b, false)
        : v,
    );
  }, [selectionKey, hlKey, nat, update]);

  return { vp, nat, setNat, view, update, full, toggleFull: () => setFull((f) => !f) };
}
