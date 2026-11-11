import { useEffect, useRef, useState } from "react";
import { ekranTemasi, type GrafikTema } from "@/pages/Reports/_v2/grafik/tema";

export type ChartTheme = GrafikTema;

/** Tema değişimini izler: koyu kip (`class`), hazır tema / özel renk (`data-preset`, `style`) — canvas CSS değişkenini kendisi izlemez. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => setVersion((s) => s + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-preset", "style"] });
    return () => observer.disconnect();
  }, []);
  return version;
}

export interface EChartProps {
  /** Saf seçenek kurucu — tema paleti `--chart-*` belirteçlerinden. */
  option: (theme: ChartTheme) => Record<string, unknown>;
  height: number;
  /** Ekran okuyucu etiketi (grafik `role="img"`). */
  label: string;
}

/**
 * Ortak ECharts kabı — rapor grafiğiyle aynı motor (`_v2/grafik/motor`, tembel yükleme; yeni Recharts yok).
 * Renkler sabit değil, belirteçten: tema rengi değişince grafik yeniden boyanır.
 */
export function EChart({ option, height, label }: EChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const version = useThemeVersion();

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void import("@/pages/Reports/_v2/grafik/motor").then(({ echarts }) => {
      const el = host.current;
      if (cancelled || !el) return;
      const chart = echarts.init(el, null, { renderer: "canvas" });
      chart.setOption(option(ekranTemasi()));
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => chart.resize());
      observer?.observe(el);
      dispose = () => {
        observer?.disconnect();
        chart.dispose();
      };
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [option, version]);

  return <div ref={host} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}

/** `hsl(250, 72%, 58%)` → aynı renk, verilen saydamlıkla (alan dolgusu degradesi için). */
export function withAlpha(color: string, alpha: number): string {
  const m = /^hsl\((.+)\)$/.exec(color);
  return m ? `hsla(${m[1]}, ${alpha})` : color;
}
