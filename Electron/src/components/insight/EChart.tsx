import { useMemo, useRef } from "react";
import { ekranTemasi, type GrafikTema } from "@/pages/Reports/_v2/grafik/tema";
import { useAppearanceVersion, useEChartInstance } from "./useEChartInstance";

export type ChartTheme = GrafikTema;

export interface EChartProps {
  /** Saf seçenek kurucu — tema paleti `--chart-*` belirteçlerinden. */
  option: (theme: ChartTheme) => Record<string, unknown>;
  height: number;
  /** Ekran okuyucu etiketi (grafik `role="img"`). */
  label: string;
}

/**
 * Ortak ECharts kabı — rapor grafiğiyle aynı motor (`_v2/grafik/motor`, tembel yükleme; yeni Recharts yok).
 * Görünüm değişince aynı örnekte yeniden boyanır (yeniden kurulmaz → yanıp sönmez, renk yumuşak geçer).
 */
export function EChart({ option, height, label }: EChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const version = useAppearanceVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` tema belirteçlerini yeniden okutur
  const built = useMemo(() => option(ekranTemasi()), [option, version]);
  useEChartInstance(host, built);
  return <div ref={host} role="img" aria-label={label} style={{ height, width: "100%" }} />;
}

/** `hsl(250, 72%, 58%)` → aynı renk, verilen saydamlıkla (alan dolgusu degradesi için). */
export function withAlpha(color: string, alpha: number): string {
  const m = /^hsl\((.+)\)$/.exec(color);
  return m ? `hsla(${m[1]}, ${alpha})` : color;
}
