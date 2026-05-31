import { useId } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "@/lib/chart-theme";

interface BarDef {
  key: string;
  label: string;
  color?: string;
}

interface Props<T> {
  data: T[];
  xKey: string;
  bars: BarDef[];
  /** Y ekseninde sayı formatı (ör. metraj → "12.500 m"). */
  formatValue?: (v: number) => string;
  /** X ekseninde kategori formatı. */
  formatCategory?: (v: string) => string;
  horizontal?: boolean;
}

export function SimpleBarChart<T>({
  data,
  xKey,
  bars,
  formatValue,
  formatCategory,
  horizontal = false,
}: Props<T>) {
  // recharts v3 formatter sözleşmesi: parametre `unknown`; safe-cast üzerinden geç.
  const valueFmt = formatValue ? (v: unknown) => formatValue(Number(v)) : undefined;
  const catFmt = formatCategory ? (v: unknown) => formatCategory(String(v)) : undefined;
  const uid = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 6, right: 12, left: 0, bottom: 6 }}
      >
        <defs>
          {bars.map((b, idx) => {
            const color = b.color ?? CHART_COLORS[idx % CHART_COLORS.length];
            return (
              <linearGradient key={b.key} id={`${uid}-${b.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.95} />
                <stop offset="100%" stopColor={color} stopOpacity={0.45} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={!horizontal} horizontal={horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={valueFmt} fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <YAxis
              type="category"
              dataKey={xKey}
              tickFormatter={catFmt}
              fontSize={11}
              width={120}
              stroke="hsl(var(--muted-foreground))"
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tickFormatter={catFmt} fontSize={11} stroke="hsl(var(--muted-foreground))" />
            <YAxis tickFormatter={valueFmt} fontSize={11} stroke="hsl(var(--muted-foreground))" />
          </>
        )}
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
            borderRadius: 6,
          }}
          formatter={valueFmt}
          labelFormatter={catFmt}
        />
        {bars.map((b, idx) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label}
            fill={`url(#${uid}-${b.key})`}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
