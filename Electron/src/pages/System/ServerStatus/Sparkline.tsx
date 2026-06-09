import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import type { Sample } from "./serverHealth";

interface Props {
  data: Sample[];
  dataKey: keyof Sample;
  color: string;
  /** Y ekseni üst sınırı (yüzde grafikleri için 100). */
  max?: number;
}

/**
 * Eksensiz, etiketsiz mini trend grafiği — son ~2 dk'lık örnekler. Veri tamamen
 * istemci tarafında (useServerHealth ring buffer); backend'e ek istek YOK.
 */
export function Sparkline({ data, dataKey, color, max = 100 }: Props) {
  if (data.length < 2) {
    return <div className="h-10 w-full" aria-hidden />;
  }
  const gradId = `spark-${String(dataKey)}`;
  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[0, max]} hide />
          <Area
            type="monotone"
            dataKey={dataKey as string}
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
