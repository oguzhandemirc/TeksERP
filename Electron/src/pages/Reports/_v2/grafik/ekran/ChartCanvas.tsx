import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTheme } from "next-themes";
import type { GrafikBlok } from "../../sunum";
import type { Egilim } from "../secenek";
import type { ChartKind } from "./gorunum";
import { screenPalette } from "./palet";
import { screenOption } from "./ekranSecenek";

export interface ChartCanvasHandle {
  /** Grafiğin PNG görüntüsü (data URL); motor yüklenmediyse null. */
  toPng: () => string | null;
}

interface Props {
  blok: GrafikBlok;
  kind: ChartKind;
  labels: boolean;
  height: number;
  title?: string;
  egilim?: Egilim | null;
}

interface EchartsLike {
  setOption: (o: unknown, notMerge?: boolean) => void;
  resize: () => void;
  dispose: () => void;
  getDataURL: (o: { type: "png"; pixelRatio: number; backgroundColor: string }) => string;
}

/** Tema/kişiselleştirme (kök öğenin sınıf/stil/data-*) değişince artan sayaç — canvas CSS değişkenini izlemez. */
function useAppearanceVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setV((x) => x + 1));
    mo.observe(document.documentElement, { attributes: true });
    return () => mo.disconnect();
  }, []);
  return v;
}

/** Ekran grafiği tuvali (ECharts, tembel motor); tür/etiket/tema değişince yeniden çizer. */
export const ChartCanvas = forwardRef<ChartCanvasHandle, Props>(function ChartCanvas({ blok, kind, labels, height, title, egilim }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<EchartsLike | null>(null);
  const { resolvedTheme } = useTheme();
  const appearance = useAppearanceVersion();

  useImperativeHandle(ref, () => ({
    toPng: () => {
      const c = chart.current;
      if (!c) return null;
      return c.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: screenPalette().card });
    },
  }));

  useEffect(() => {
    if (!box.current) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void import("../motor").then(({ echarts }) => {
      const el = box.current;
      if (cancelled || !el) return;
      const c = echarts.init(el, null, { renderer: "canvas" }) as unknown as EchartsLike;
      c.setOption(screenOption(blok, kind, screenPalette(), { labels, egilim }), true);
      chart.current = c;
      const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => c.resize());
      ro?.observe(el);
      cleanup = () => {
        ro?.disconnect();
        c.dispose();
        chart.current = null;
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [blok, kind, labels, egilim, resolvedTheme, appearance]);

  return <div ref={box} role="img" aria-label={title ?? blok.eksen.y.ad} data-chart-kind={kind} style={{ height, width: "100%" }} />;
});
