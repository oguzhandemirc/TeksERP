import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

interface Props<T> {
  data: T[];
  nameKey: string;
  valueKey: string;
  formatValue?: (v: number) => string;
  colors?: string[];
}

const DEFAULT_COLORS = ["#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

export function SimplePieChart<T>({
  data,
  nameKey,
  valueKey,
  formatValue,
  colors = DEFAULT_COLORS,
}: Props<T>) {
  const valueFmt = formatValue ? (v: unknown) => formatValue(Number(v)) : undefined;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          nameKey={nameKey}
          dataKey={valueKey}
          innerRadius="45%"
          outerRadius="80%"
          paddingAngle={1}
        >
          {data.map((_, idx) => (
            <Cell key={idx} fill={colors[idx % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            fontSize: 12,
            borderRadius: 6,
          }}
          formatter={valueFmt}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          iconSize={10}
          layout="vertical"
          align="right"
          verticalAlign="middle"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
