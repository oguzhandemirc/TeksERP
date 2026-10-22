// Küçük eğilim çizgisi (7–30 nokta): yalnız react-native-svg. Değerleri ölçeklemekle yetinir; hesap yapmaz.
import Svg, { Circle, Polyline } from "react-native-svg";
import { useTokens } from "../theme-context";
import type { Domain } from "../tokens";

export interface SparklineProps {
  readonly data: readonly number[];
  readonly width?: number;
  readonly height?: number;
  readonly domain?: Domain;
  /** Doğrudan renk (token'dan okunmuş); verilmezse alan rengi. */
  readonly color?: string;
  readonly accessibilityLabel?: string;
}

export function sparkPoints(data: readonly number[], width: number, height: number, pad = 2): { x: number; y: number }[] {
  const finite = data.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = finite.length > 1 ? (width - pad * 2) / (finite.length - 1) : 0;
  return finite.map((v, i) => ({ x: pad + i * step, y: height - pad - ((v - min) / span) * (height - pad * 2) }));
}

export function Sparkline({ data, width = 96, height = 28, domain = "genel", color, accessibilityLabel }: SparklineProps) {
  const t = useTokens();
  const pts = sparkPoints(data, width, height);
  if (pts.length === 0) return null;
  const stroke = color ?? t.domain[domain].fg;
  const last = pts[pts.length - 1]!;
  return (
    <Svg width={width} height={height} accessibilityLabel={accessibilityLabel} accessible={!!accessibilityLabel}>
      <Polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={stroke} strokeOpacity={0.6} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={2.5} fill={stroke} />
    </Svg>
  );
}
