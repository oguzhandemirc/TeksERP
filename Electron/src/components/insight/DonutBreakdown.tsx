import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { formatDisplay } from "@/lib/format";
import { EChart, type ChartTheme } from "./EChart";
import { SERIES_DOT } from "./chart-parts";

export interface DonutSlice {
  key: string;
  name: string;
  value: number;
  /** Payı (0–100); verilmezse toplamdan hesaplanır. */
  percent?: number;
}

export interface DonutBreakdownProps {
  slices: DonutSlice[];
  formatValue: (v: number) => string;
  /** Halkanın ortasındaki ikinci satır ("metre"). */
  centerCaption: string;
  /** Ekran okuyucu etiketi. */
  label: string;
  /** Dilim yokken lejant yerine yazılan cümle. */
  emptyText: string;
  size?: number;
}

/** Halka + lejant (hedef görsel "genel bakış" kutusu). Kartın genişliğine göre yan yana / alt alta dizilir. */
export function DonutBreakdown({ slices, formatValue, centerCaption, label, emptyText, size = 176 }: DonutBreakdownProps) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const empty = slices.length === 0;
  const option = useCallback(
    (t: ChartTheme) => ({
      animation: true,
      // Boşken tek soluk halka (ızgara rengi) — ortadaki 0 ile "iskelet" okunur.
      color: empty ? [t.izgara] : t.renkler,
      textStyle: { fontFamily: t.yaziTipi, color: t.metin },
      tooltip: { show: !empty, trigger: "item", valueFormatter: (v: unknown) => (typeof v === "number" ? formatValue(v) : "—") },
      title: {
        text: formatDisplay(total, 0),
        subtext: centerCaption,
        left: "center",
        top: "38%",
        textStyle: { color: empty ? t.ikincil : t.metin, fontSize: 20, fontWeight: 700 },
        subtextStyle: { color: t.ikincil, fontSize: 11 },
      },
      series: [{
        type: "pie",
        radius: ["60%", "86%"],
        padAngle: empty ? 0 : 2,
        itemStyle: { borderRadius: 4 },
        label: { show: false },
        silent: empty,
        data: empty ? [{ name: "", value: 1 }] : slices.map((d) => ({ name: d.name, value: d.value })),
      }],
    }),
    [slices, total, empty, formatValue, centerCaption],
  );
  const pct = (d: DonutSlice) => d.percent ?? (total > 0 ? (d.value / total) * 100 : 0);
  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-4 @[26rem]:flex-row">
        <div className="relative shrink-0" style={{ width: size }}><EChart option={option} height={size} label={label} /></div>
        {empty ? (
          <p className="w-full text-center text-xs text-muted-foreground @[26rem]:text-left">{emptyText}</p>
        ) : (
          <ul className="w-full min-w-0 space-y-2 text-xs">
            {slices.map((d, i) => (
              <li key={d.key} className="flex items-center gap-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", SERIES_DOT[i % SERIES_DOT.length])} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={d.name}>{d.name}</span>
                <span className="tabular-nums text-muted-foreground">{formatValue(d.value)}</span>
                <span className="w-9 text-right font-semibold tabular-nums">%{formatDisplay(pct(d), 0)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
