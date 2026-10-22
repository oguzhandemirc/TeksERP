// KPI kartı: sol alan şeridi · ikon çipi + etiket · büyük sayı (birim küçük) · eğilim satırı · isteğe bağlı sparkline
// ve durum noktası. Ekran okuyucu tek etiket duyar: "Etiket: değer birim, eğilim, durum".
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { Sparkline } from "./charts/Sparkline";
import type { IconName } from "./icons";
import { IconChip } from "./IconChip";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, STRIPE, TOUCH, radius, space, tabularNums, typography, type Domain, type StatusKind } from "./tokens";

export interface KpiTrend {
  /** Görünen metin, işaretli: "+%12 düne göre". */
  readonly text: string;
  /** Yön ok şekliyle söylenir; iyi/kötü anlamı `tone`dadır (yön ≠ anlam). */
  readonly direction: "up" | "down" | "flat";
  readonly tone: StatusKind;
}

export interface KpiCardProps {
  readonly label: string;
  /** Biçimlenmiş değer ("12.480"). Uygulama aritmetik yapmaz; değer fabrikadan gelir. */
  readonly value: string;
  readonly unit?: string;
  readonly domain: Domain;
  readonly icon?: IconName;
  readonly trend?: KpiTrend;
  readonly status?: { readonly kind: StatusKind; readonly label: string };
  readonly spark?: readonly number[];
  readonly onPress?: () => void;
  readonly testID?: string;
}

const ARROW: Readonly<Record<KpiTrend["direction"], IconName>> = { up: "arrow-up", down: "arrow-down", flat: "remove" };

export function kpiAccessibilityLabel(p: Pick<KpiCardProps, "label" | "value" | "unit" | "trend" | "status">): string {
  const parts = [`${p.label}: ${p.value}${p.unit ? ` ${p.unit}` : ""}`];
  if (p.trend) parts.push(p.trend.text);
  if (p.status) parts.push(p.status.label);
  return parts.join(", ");
}

export function KpiCard(p: KpiCardProps) {
  const t = useTokens();
  const s = useStyles();
  const body = (
    <>
      <View style={[s.stripe, { backgroundColor: t.domain[p.domain].fg }]} />
      <View style={s.head}>
        <IconChip domain={p.domain} icon={p.icon} />
        <Text style={s.label} numberOfLines={2}>{p.label}</Text>
        {p.status ? <View style={[s.dot, { backgroundColor: t.status[p.status.kind].fill }]} /> : null}
      </View>
      <View style={s.valueRow}>
        <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE.title}>{p.value}</Text>
        {p.unit ? <Text style={s.unit}>{p.unit}</Text> : null}
      </View>
      <View style={s.foot}>
        {p.trend ? (
          <View style={s.trend}>
            <Ionicons name={ARROW[p.trend.direction]} size={14} color={t.status[p.trend.tone].fill} />
            <Text style={[s.trendText, { color: t.status[p.trend.tone].fill }]}>{p.trend.text}</Text>
          </View>
        ) : <View />}
        {p.spark && p.spark.length > 1 ? <Sparkline data={p.spark} domain={p.domain} width={72} height={24} /> : null}
      </View>
    </>
  );
  const a11y = kpiAccessibilityLabel(p);
  if (!p.onPress) {
    return <View style={s.card} testID={p.testID} accessible accessibilityLabel={a11y}>{body}</View>;
  }
  return (
    <Pressable onPress={p.onPress} testID={p.testID} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [s.card, pressed && s.pressed]}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: TOUCH * 2,
    backgroundColor: t.surface,
    borderRadius: radius.card,
    padding: space.l,
    paddingLeft: space.l + STRIPE,
    overflow: "hidden" as const,
    ...t.cardShadow,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  label: { ...typography.caption, color: t.textSecondary, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  valueRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: space.xs, marginTop: space.s },
  value: { ...typography.kpi, color: t.text, flexShrink: 1 },
  unit: { ...typography.subhead, color: t.textSecondary },
  foot: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, marginTop: space.xs, minHeight: 24 },
  trend: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2 },
  trendText: { ...typography.footnote, ...tabularNums, fontWeight: "600" as const },
}));
