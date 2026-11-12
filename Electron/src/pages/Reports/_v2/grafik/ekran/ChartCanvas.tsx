import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useAppearanceVersion, useEChartInstance } from "@/components/insight/useEChartInstance";
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

/** Ekran grafiği tuvali (ECharts, tembel motor); tür/etiket/tema değişince yeniden çizer. */
export const ChartCanvas = forwardRef<ChartCanvasHandle, Props>(function ChartCanvas({ blok, kind, labels, height, title, egilim }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const appearance = useAppearanceVersion();
  // Görünüm/tür değişimi aynı örnekte uygulanır (dispose+init yok → yanıp sönmez).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `appearance` tema belirteçlerini yeniden okutur
  const option = useMemo(() => screenOption(blok, kind, screenPalette(), { labels, egilim }) as Record<string, unknown>, [blok, kind, labels, egilim, appearance]);
  const chart = useEChartInstance(box, option);

  useImperativeHandle(ref, () => ({
    toPng: () => {
      const c = chart.current;
      if (!c) return null;
      return c.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: screenPalette().card });
    },
  }));

  return <div ref={box} role="img" aria-label={title ?? blok.eksen.y.ad} data-chart-kind={kind} style={{ height, width: "100%" }} />;
});
