import { useEffect, useRef, useState, type RefObject } from "react";

/** Kullanılan ECharts örnek yüzeyi (motor tembel yüklenir; tip için çekirdeği statik içe almayız). */
export interface EchartsInstance {
  setOption: (o: unknown, opts?: { notMerge?: boolean; lazyUpdate?: boolean }) => void;
  resize: () => void;
  dispose: () => void;
  getDom: () => HTMLElement;
  getDataURL: (o: { type: "png"; pixelRatio: number; backgroundColor: string }) => string;
}

type InitFn = (el: HTMLElement, theme: null, opts: { renderer: "canvas" }) => EchartsInstance;

let motorCache: InitFn | null = null;
function loadMotor(): Promise<InitFn> {
  return import("@/pages/Reports/_v2/grafik/motor").then(({ echarts }) => {
    motorCache = (el, theme, opts) => echarts.init(el, theme, opts) as unknown as EchartsInstance;
    return motorCache;
  });
}

/** Görünüm (tema rengi, kip, yoğunluk, köşe, yazı tipi) değişince artan sayaç — canvas CSS değişkenini izlemez. */
export function useAppearanceVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setV((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true });
    return () => mo.disconnect();
  }, []);
  return v;
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Seri dizilimi (tür + ad/kimlik); aynıysa birleştirerek güncellenir → renk/değer yumuşak geçer. */
export function seriesShape(option: Record<string, unknown>): string {
  const s = option.series;
  const list = Array.isArray(s) ? s : s ? [s] : [];
  return JSON.stringify(list.map((x: Record<string, unknown>) => [x.type, x.id ?? x.name ?? null]));
}

/** Geçiş süresi seçeneğe eklenir; hareket azaltılmışsa animasyon kapalı. */
export function withMotion(option: Record<string, unknown>): Record<string, unknown> {
  if (reducedMotion()) return { ...option, animation: false };
  return { animationDurationUpdate: 400, animationEasingUpdate: "cubicInOut", ...option };
}

/**
 * Tek ECharts örneği: ilk çizimde kurulur, sökülene kadar YAŞAR. Seçenek/tema değişimi aynı örnekte
 * `setOption` ile uygulanır (dispose+init yok → grafik yanıp sönmez). Seri dizilimi değişirse tam değiştirme.
 */
export function useEChartInstance(host: RefObject<HTMLDivElement | null>, option: Record<string, unknown> | null): RefObject<EchartsInstance | null> {
  const chart = useRef<EchartsInstance | null>(null);
  const resize = useRef<ResizeObserver | null>(null);
  const shape = useRef("");
  const [init, setInit] = useState<InitFn | null>(() => motorCache);

  useEffect(() => {
    if (init) return;
    let live = true;
    void loadMotor().then((fn) => { if (live) setInit(() => fn); });
    return () => { live = false; };
  }, [init]);

  // Kap boyutsuzken (gizli sekme, ölçülmemiş düzen) kurulmaz; boyut gelince gözlemci yeniden dener.
  const [sizeTick, setSizeTick] = useState(0);
  useEffect(() => {
    const el = host.current;
    let c = chart.current;
    if (c && (!el || !option || c.getDom() !== el)) {
      resize.current?.disconnect();
      c.dispose();
      c = chart.current = null;
    }
    if (!init || !el || !option) return;
    if (!c) {
      resize.current?.disconnect();
      resize.current = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
        if (chart.current) chart.current.resize();
        else setSizeTick((x) => x + 1);
      });
      resize.current?.observe(el);
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      c = chart.current = init(el, null, { renderer: "canvas" });
      shape.current = "";
    }
    const next = seriesShape(option);
    c.setOption(withMotion(option), { notMerge: next !== shape.current });
    shape.current = next;
  }, [init, option, host, sizeTick]);

  useEffect(() => () => {
    resize.current?.disconnect();
    chart.current?.dispose();
    chart.current = null;
  }, []);

  return chart;
}
