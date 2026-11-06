import { useEffect, useState, type RefObject } from "react";

/**
 * Yatay kaydırılan kabın görünmeyen içeriği var mı (sol/sağ)? Dar ekranda kutu bölgesinin
 * kenarı soluklaşır ki "kaydırılabilir" anlaşılsın — kesik kutu hata gibi görünmesin.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): { left: boolean; right: boolean } {
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    for (const c of Array.from(el.children)) ro?.observe(c);
    return () => {
      el.removeEventListener("scroll", measure);
      ro?.disconnect();
    };
  });
  return edges;
}
