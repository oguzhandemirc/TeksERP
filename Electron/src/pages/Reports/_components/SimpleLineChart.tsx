import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "@/lib/chart-theme";

interface LineDef {
  key: string;
  label: string;
  color?: string;
}

interface Props<T> {
  data: T[];
  xKey: string;
  lines: LineDef[];
  formatValue?: (v: number) => string;
  formatCategory?: (v: string) => string;
}

export function SimpleLineChart<T>({
  data,
  xKey,
  lines,
  formatValue,
  formatCategory,
}: Props<T>) {
  const valueFmt = formatValue ? (v: unknown) => formatValue(Number(v)) : undefined;
  const catFmt = formatCategory ? (v: unknown) => formatCategory(String(v)) : undefined;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 6 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey={xKey} tickFormatter={catFmt} fontSize={11} stroke="hsl(var(--muted-foreground))" />
        <YAxis tickFormatter={valueFmt} fontSize={11} stroke="hsl(var(--muted-foreground))" />
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
        {lines.map((l, idx) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.label}
            stroke={l.color ?? CHART_COLORS[idx % CHART_COLORS.length]}
            strokeWidth={2}
            dot={{ r: 2 }}
            activeDot={{ r: 4 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
