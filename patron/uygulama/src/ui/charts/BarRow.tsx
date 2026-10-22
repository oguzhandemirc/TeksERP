// Yatay yüzde çubuğu: etiket · çubuk · değer metni. Oran = value / max (max ≤ 0 ise boş çubuk).
import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { makeStyles, useTokens } from "../theme-context";
import { space, tabularNums, typography, type Domain } from "../tokens";

export interface BarRowProps {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  /** Ekranda gösterilecek değer (biçimlenmiş, birimli). */
  readonly valueText: string;
  readonly domain?: Domain;
  readonly color?: string;
  readonly testID?: string;
}

export function barRatio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

export function BarRow({ label, value, max, valueText, domain = "genel", color, testID }: BarRowProps) {
  const t = useTokens();
  const s = useStyles();
  const ratio = barRatio(value, max);
  return (
    <View style={s.row} testID={testID} accessible accessibilityLabel={`${label}: ${valueText}`}>
      <View style={s.head}>
        <Text style={s.label} numberOfLines={1}>{label}</Text>
        <Text style={s.value}>{valueText}</Text>
      </View>
      <Svg width="100%" height={8}>
        <Rect x={0} y={0} width="100%" height={8} rx={4} fill={t.surfaceAlt} />
        {ratio > 0 ? <Rect x={0} y={0} width={`${ratio * 100}%`} height={8} rx={4} fill={color ?? t.domain[domain].fg} /> : null}
      </Svg>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: { marginBottom: space.m },
  head: { flexDirection: "row" as const, justifyContent: "space-between" as const, marginBottom: space.xs, gap: space.s },
  label: { ...typography.subhead, color: t.text, flexShrink: 1 },
  value: { ...typography.subhead, ...tabularNums, color: t.textSecondary },
}));
