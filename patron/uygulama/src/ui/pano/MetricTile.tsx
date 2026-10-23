// Ölçü kutusu: KpiCard anatomisi (sol alan şeridi · ikon çipi + etiket · büyük sayı + birim) + altında fabrikanın
// verdiği yan değerler (iki dönem yan yana, top sayısı, döviz satırları). Karşılaştırma HESAPLANMAZ, yan yana gösterilir.
// KpiCard'da yan değer yuvası yok (W'ye not); bu ekranlara özel kalır.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { IconName } from "../icons";
import { IconChip } from "../IconChip";
import { kpiAccessibilityLabel } from "../KpiCard";
import { StatusBadge } from "../StatusBadge";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, STRIPE, TOUCH, radius, space, tabularNums, typography, type Domain, type StatusKind } from "../tokens";

export interface MetricLine {
  readonly label: string;
  readonly value: string;
  /** Değer durum anlamı taşıyorsa (geciken > 0) rengi. */
  readonly tone?: StatusKind;
}

export interface MetricTileProps {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
  /** Sayının altındaki küçük açıklama ("Bugün", "Alınan çek · 3 adet"). */
  readonly caption?: string;
  readonly domain: Domain;
  readonly icon?: IconName;
  readonly status?: { readonly kind: StatusKind; readonly label: string };
  readonly lines?: readonly MetricLine[];
  /** `stack`: etiket üstte, değer altta (uzun para satırları dar kutuda kırpılmasın). */
  readonly lineLayout?: "row" | "stack";
  readonly onPress?: () => void;
  readonly testID?: string;
}

/** Uzun değer ("23.120 m", "385.000 ₺") dar kutuda kırpılmasın: web'de `adjustsFontSizeToFit` yok, boyu uzunluk seçer. */
export function valueSize(value: string, unit?: string): { fontSize: number; lineHeight: number } | null {
  const n = value.length + (unit ? Math.ceil(unit.length / 2) : 0);
  if (n <= 6) return null;
  if (n <= 8) return { fontSize: 28, lineHeight: 34 };
  if (n <= 11) return { fontSize: 24, lineHeight: 30 };
  return { fontSize: 20, lineHeight: 26 };
}

export function MetricTile(p: MetricTileProps) {
  const t = useTokens();
  const s = useStyles();
  const a11y = [
    kpiAccessibilityLabel({ label: p.label, value: p.value, unit: p.unit, status: p.status }),
    p.caption,
    ...(p.lines ?? []).map((l) => `${l.label} ${l.value}`),
  ]
    .filter(Boolean)
    .join(", ");
  const body = (
    <>
      <View style={[s.stripe, { backgroundColor: t.domain[p.domain].fg }]} />
      <View style={s.head}>
        <IconChip domain={p.domain} icon={p.icon} size={30} />
        <Text style={s.label} numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE.title}>{p.label}</Text>
        {p.onPress ? <Ionicons name="chevron-forward" size={16} color={t.textMuted} /> : null}
      </View>
      <View style={s.valueRow}>
        <Text style={[s.value, valueSize(p.value, p.unit)]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} maxFontSizeMultiplier={FONT_SCALE.title}>{p.value}</Text>
        {p.unit ? <Text style={s.unit} maxFontSizeMultiplier={FONT_SCALE.title}>{p.unit}</Text> : null}
      </View>
      {p.caption ? <Text style={s.caption} numberOfLines={2}>{p.caption}</Text> : null}
      {p.status ? <View style={s.badge}><StatusBadge kind={p.status.kind} label={p.status.label} size="sm" /></View> : null}
      {p.lines && p.lines.length > 0 ? (
        <View style={s.lines}>
          {p.lines.map((l) => (
            <View key={l.label} style={p.lineLayout === "stack" ? s.lineStack : s.line}>
              <Text style={s.lineLabel} numberOfLines={1}>{l.label}</Text>
              <Text style={[s.lineValue, l.tone ? { color: t.status[l.tone].fill } : null]} numberOfLines={1}>{l.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );
  if (!p.onPress) {
    return <View style={s.card} testID={p.testID} accessible accessibilityLabel={a11y}>{body}</View>;
  }
  return (
    <Pressable onPress={p.onPress} testID={p.testID} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => [s.card, pressed && s.pressed]}>
      {body}
    </Pressable>
  );
}

/** KPI ızgarası: telefonda 2'li, genişte 4'lü (kutu en az 150). */
export function MetricGrid({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) {
  const s = useStyles();
  return <View style={s.grid} testID={testID}>{children}</View>;
}

const useStyles = makeStyles((t) => ({
  grid: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: space.m, marginBottom: space.m },
  card: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: TOUCH * 2.5,
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
  label: { ...typography.footnote, fontWeight: "600" as const, color: t.textSecondary, flex: 1 },
  valueRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: space.xs, marginTop: space.m },
  value: { ...typography.kpi, fontSize: 34, lineHeight: 38, color: t.text, flexShrink: 1 },
  unit: { ...typography.callout, fontWeight: "600" as const, color: t.textSecondary },
  caption: { ...typography.footnote, color: t.textSecondary, marginTop: 2 },
  badge: { marginTop: space.s },
  lines: { marginTop: space.m, paddingTop: space.s, borderTopWidth: 1, borderTopColor: t.separator, gap: space.xs },
  lineStack: { gap: 0 },
  line: { flexDirection: "row" as const, justifyContent: "space-between" as const, gap: space.s },
  lineLabel: { ...typography.footnote, color: t.textSecondary, flexShrink: 1 },
  // değer kırpılmaz; dar kutuda etiket kısalır
  lineValue: { ...typography.footnote, ...tabularNums, fontWeight: "600" as const, color: t.text, flexShrink: 0 },
}));
