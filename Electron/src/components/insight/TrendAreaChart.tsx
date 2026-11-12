import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { formatDisplay } from "@/lib/format";
import { EChart, withAlpha, type ChartTheme } from "./EChart";
import { ChartEmptyNote, SERIES_DOT } from "./chart-parts";

export interface TrendSeries {
  key: string;
  name: string;
  /** Kova başına değer; ölçülemeyen kova `null` (0 değil). */
  values: Array<number | null>;
  /** Renk sırası (`--chart-N`, 0 tabanlı); verilmezse serinin dizideki yeri. Seri gizlenince renk kaymasın diye. */
  colorIndex?: number;
}

export interface TrendAreaChartProps {
  /** X ekseni etiketleri (kova sırasıyla). */
  labels: string[];
  /** Seri sırası = renk sırası (`--chart-1`, `--chart-2`…). */
  series: TrendSeries[];
  formatValue: (v: number) => string;
  /** Ekran okuyucu etiketi. */
  label: string;
  height?: number;
  /** Bütün değerler boş/0 iken grafiğin üstündeki not. */
  emptyText?: string;
  /** Grafiğin üstünde seri toplamları (renk noktası + ad + toplam). */
  showTotals?: boolean;
}

/** Çok serili yumuşak alan grafiği (hedef görsel "performans" kutusu); renkler tema belirtecinden. */
export function TrendAreaChart({ labels, series, formatValue, label, height = 220, emptyText = "Bu dönemde veri yok", showTotals = true }: TrendAreaChartProps) {
  const empty = series.every((s) => s.values.every((v) => !v));
  // Veri tek kovadaysa yumuşak alan eğimli bir tepe uydurur (yanıltıcı) — o zaman çubuk çizilir.
  const filledBuckets = labels.filter((_, i) => series.some((s) => (s.values[i] ?? 0) !== 0)).length;
  const asBars = !empty && filledBuckets <= 1;
  const option = useCallback(
    (t: ChartTheme) => {
      // Boş dönem: aynı eksenler, soluk çizgi, sabit üst sınır — ECharts 0..1 eksenini göstermesin.
      const build = (s: TrendSeries, i: number) => {
        const color = empty ? t.izgara : (t.renkler[(s.colorIndex ?? i) % t.renkler.length] ?? t.renkler[0]!);
        if (asBars) {
          return { name: s.name, type: "bar", barMaxWidth: 14, barGap: "20%", data: s.values, itemStyle: { color, borderRadius: [4, 4, 0, 0] }, emphasis: { focus: "series" } };
        }
        return {
          name: s.name,
          type: "line",
          smooth: true,
          showSymbol: false,
          data: s.values,
          lineStyle: { width: 2.5, color },
          itemStyle: { color },
          emphasis: { focus: "series" },
          areaStyle: {
            color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: withAlpha(color, empty ? 0 : 0.38) }, { offset: 1, color: withAlpha(color, 0.02) }] },
          },
        };
      };
      return {
        animation: true,
        textStyle: { fontFamily: t.yaziTipi, color: t.metin, fontSize: 11 },
        grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
        tooltip: { show: !empty, trigger: "axis", axisPointer: asBars ? { type: "shadow" } : { type: "line", lineStyle: { color: t.ikincil, type: "dashed" } }, valueFormatter: (v: unknown) => (typeof v === "number" ? formatValue(v) : "—") },
        xAxis: { type: "category", boundaryGap: asBars, data: labels, axisLabel: { color: t.ikincil, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
        yAxis: {
          type: "value",
          ...(empty ? { min: 0, max: 1000, interval: 250 } : {}),
          axisLabel: { color: t.ikincil, formatter: (v: number) => formatDisplay(v, 0) },
          splitLine: { lineStyle: { color: t.izgara, type: "dashed" } },
        },
        series: series.map(build),
      };
    },
    [labels, series, empty, asBars, formatValue],
  );
  const total = (s: TrendSeries) => s.values.reduce<number>((a, v) => a + (v ?? 0), 0);
  return (
    <div className="min-w-0">
      {showTotals && (
        <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1">
          {series.map((s, i) => (
            <div key={s.key} className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2 w-2 rounded-full", SERIES_DOT[(s.colorIndex ?? i) % SERIES_DOT.length])} aria-hidden />
                {s.name}
              </p>
              <p className="text-xl font-bold leading-tight tabular-nums">{formatValue(total(s))}</p>
            </div>
          ))}
        </div>
      )}
      <div className="relative" data-chart-kind={asBars ? "bar" : "area"}>
        <EChart option={option} height={height} label={label} />
        {empty && <ChartEmptyNote text={emptyText} />}
      </div>
    </div>
  );
}
