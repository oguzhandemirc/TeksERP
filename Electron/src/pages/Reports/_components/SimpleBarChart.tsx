import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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

const DEFAULT_COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"];

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

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 6, right: 12, left: 0, bottom: 6 }}
      >
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
            fill={b.color ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]}
            radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
