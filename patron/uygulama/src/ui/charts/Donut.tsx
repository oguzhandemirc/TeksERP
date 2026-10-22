// Halka grafik (≤ 4 dilim önerilir): yalnız react-native-svg; ortada isteğe bağlı metin.
import { Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { makeStyles, useTokens } from "../theme-context";
import { tabularNums, typography } from "../tokens";

export interface DonutSlice {
  readonly label: string;
  readonly value: number;
  /** Token'dan okunmuş renk (ör. `t.domain.finans.fg`, `t.status.iyi.fill`). */
  readonly color: string;
}

export function donutArcs(values: readonly number[], circumference: number): { length: number; offset: number }[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((a, b) => a + b, 0);
  let acc = 0;
  return clean.map((v) => {
    const length = total > 0 ? (v / total) * circumference : 0;
    const arc = { length, offset: -acc };
    acc += length;
    return arc;
  });
}

export function Donut({ slices, size = 120, thickness = 14, centerText, testID }: { readonly slices: readonly DonutSlice[]; readonly size?: number; readonly thickness?: number; readonly centerText?: string; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const arcs = donutArcs(slices.map((x) => x.value), c);
  return (
    <View style={{ width: size, height: size }} testID={testID} accessible accessibilityLabel={slices.map((x) => `${x.label}: ${x.value}`).join(", ")}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.surfaceAlt} strokeWidth={thickness} fill="none" />
        {slices.map((x, i) => {
          const a = arcs[i]!;
          return a.length > 0 ? (
            <Circle
              key={x.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={x.color}
              strokeWidth={thickness}
              fill="none"
              strokeDasharray={`${a.length} ${c}`}
              strokeDashoffset={a.offset}
              rotation={-90}
              originX={size / 2}
              originY={size / 2}
            />
          ) : null;
        })}
      </Svg>
      {centerText ? (
        <View style={s.center} pointerEvents="none">
          <Text style={s.text}>{centerText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  center: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0, alignItems: "center" as const, justifyContent: "center" as const },
  text: { ...typography.headline, ...tabularNums, color: t.text },
}));
