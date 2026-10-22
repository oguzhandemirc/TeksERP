// Kahraman özet: başlık + tek büyük sayı + en çok 3 mini sayı; zemin opak, alan rengi yalnız şerit ve ikon çipinde.
import { Text, View } from "react-native";
import { IconChip } from "./IconChip";
import type { IconName } from "./icons";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, STRIPE, radius, space, tabularNums, typography, type Domain } from "./tokens";

export interface HeroMini {
  readonly label: string;
  readonly value: string;
}

export interface HeroSummaryProps {
  readonly title: string;
  readonly value: string;
  readonly unit?: string;
  readonly caption?: string;
  readonly domain?: Domain;
  readonly icon?: IconName;
  readonly minis?: readonly HeroMini[];
  readonly testID?: string;
}

export function HeroSummary(p: HeroSummaryProps) {
  const t = useTokens();
  const s = useStyles();
  const domain = p.domain ?? "genel";
  return (
    <View style={s.card} testID={p.testID} accessible accessibilityLabel={`${p.title}: ${p.value}${p.unit ? ` ${p.unit}` : ""}`}>
      <View style={[s.stripe, { backgroundColor: t.domain[domain].fg }]} />
      <View style={s.head}>
        <IconChip domain={domain} icon={p.icon} />
        <Text style={s.title} maxFontSizeMultiplier={FONT_SCALE.title}>{p.title}</Text>
      </View>
      <View style={s.valueRow}>
        <Text style={s.value} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={FONT_SCALE.title}>{p.value}</Text>
        {p.unit ? <Text style={s.unit}>{p.unit}</Text> : null}
      </View>
      {p.caption ? <Text style={s.caption}>{p.caption}</Text> : null}
      {p.minis && p.minis.length > 0 ? (
        <View style={s.minis}>
          {p.minis.slice(0, 3).map((m) => (
            <View key={m.label} style={s.mini} accessible accessibilityLabel={`${m.label}: ${m.value}`}>
              <Text style={s.miniLabel} numberOfLines={1}>{m.label}</Text>
              <Text style={s.miniValue} numberOfLines={1}>{m.value}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.surface,
    borderRadius: radius.card,
    padding: space.ml,
    paddingLeft: space.ml + STRIPE,
    marginBottom: space.m,
    overflow: "hidden" as const,
    ...t.cardShadow,
  },
  stripe: { position: "absolute" as const, left: 0, top: 0, bottom: 0, width: STRIPE },
  head: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  title: { ...typography.headline, color: t.text },
  valueRow: { flexDirection: "row" as const, alignItems: "baseline" as const, gap: space.xs, marginTop: space.s },
  value: { ...typography.display, color: t.text, flexShrink: 1 },
  unit: { ...typography.title3, color: t.textSecondary },
  caption: { ...typography.footnote, color: t.textMuted, marginTop: space.xs },
  minis: { flexDirection: "row" as const, gap: space.s, marginTop: space.m },
  mini: { flex: 1, backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner, padding: space.s + 2 },
  miniLabel: { ...typography.caption, color: t.textSecondary },
  miniValue: { ...typography.headline, ...tabularNums, color: t.text, marginTop: 2 },
}));
