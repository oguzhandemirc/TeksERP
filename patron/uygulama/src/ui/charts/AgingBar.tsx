// Yaşlandırma şeridi: dilimli yığılmış çubuk (ör. 0–30 iyi · 31–60 uyarı · 60+ kritik) + renk + etiketli lejant.
import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { makeStyles, useTokens } from "../theme-context";
import { space, tabularNums, typography, type StatusKind } from "../tokens";

export interface AgingSegment {
  readonly label: string;
  readonly value: number;
  readonly tone: StatusKind;
  /** Lejantta gösterilecek değer (biçimlenmiş). */
  readonly valueText: string;
}

export function agingWidths(values: readonly number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  return total > 0 ? clean.map((v) => v / total) : clean.map(() => 0);
}

export function AgingBar({ segments, testID }: { readonly segments: readonly AgingSegment[]; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const widths = agingWidths(segments.map((x) => x.value));
  let x = 0;
  return (
    <View testID={testID} accessible accessibilityLabel={segments.map((g) => `${g.label}: ${g.valueText}`).join(", ")}>
      <Svg width="100%" height={12}>
        <Rect x={0} y={0} width="100%" height={12} rx={6} fill={t.surfaceAlt} />
        {segments.map((g, i) => {
          const w = widths[i] ?? 0;
          const at = x;
          x += w;
          return w > 0 ? <Rect key={g.label} x={`${at * 100}%`} y={0} width={`${w * 100}%`} height={12} fill={t.status[g.tone].fill} /> : null;
        })}
      </Svg>
      <View style={s.legend}>
        {segments.map((g) => (
          <View key={g.label} style={s.item}>
            <View style={[s.dot, { backgroundColor: t.status[g.tone].fill }]} />
            <Text style={s.label}>{g.label}</Text>
            <Text style={s.value}>{g.valueText}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  legend: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.m, marginTop: space.s },
  item: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { ...typography.footnote, color: t.textSecondary },
  value: { ...typography.footnote, ...tabularNums, color: t.text, fontWeight: "600" as const },
}));
