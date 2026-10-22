// "Dikkat" şeridi: kritik/uyarı maddeleri durum renginde kapsüller (ikon + başlık + açıklama); dokununca ilgili
// bölüme gider. Madde yoksa yeşil "Her şey yolunda" satırı — patron boş alanı "veri yok" sanmasın.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import { haptic } from "../haptics";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, typography, type StatusKind } from "../tokens";
import type { AttentionItem } from "./read";

export function AttentionStrip({ items, checked, onOpen }: {
  readonly items: readonly AttentionItem[];
  /** Neye bakıldığı ("yedek, siparişler…"); yolunda satırında söylenir. */
  readonly checked: string;
  readonly onOpen: (item: AttentionItem) => void;
}) {
  const s = useStyles();
  if (items.length === 0) {
    return (
      <View style={s.wrap} testID="dikkat">
        <Pill tone="iyi" title="Her şey yolunda" detail={`Dikkat isteyen konu yok · ${checked}`} testID="dikkat-yolunda" />
      </View>
    );
  }
  return (
    <View style={s.wrap} testID="dikkat" accessibilityRole="summary">
      {items.map((i) => (
        <Pill
          key={i.key}
          tone={i.tone}
          title={i.title}
          detail={i.detail}
          testID={`dikkat-${i.key}`}
          onPress={i.route || i.action ? () => { haptic("light"); onOpen(i); } : undefined}
        />
      ))}
    </View>
  );
}

function Pill({ tone, title, detail, onPress, testID }: { readonly tone: StatusKind; readonly title: string; readonly detail: string; readonly onPress?: () => void; readonly testID?: string }) {
  const t = useTokens();
  const s = useStyles();
  const c = t.status[tone];
  const body = (
    <>
      <View style={[s.icon, { backgroundColor: c.fill }]}>
        <Ionicons name={c.icon} size={20} color={t.onTint} />
      </View>
      <View style={s.text}>
        <Text style={[s.title, { color: c.text }]} maxFontSizeMultiplier={FONT_SCALE.title}>{title}</Text>
        <Text style={[s.detail, { color: c.text }]}>{detail}</Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={c.text} /> : null}
    </>
  );
  const label = `${tone === "kritik" ? "Kritik" : tone === "uyari" ? "Uyarı" : tone === "iyi" ? "Yolunda" : "Bilgi"}: ${title}. ${detail}`;
  if (!onPress) return <View style={[s.pill, { backgroundColor: c.bg }]} testID={testID} accessible accessibilityLabel={label}>{body}</View>;
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.pill, { backgroundColor: c.bg }, pressed && s.pressed]}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.s, marginBottom: space.m },
  pill: { minHeight: TOUCH + 12, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, borderRadius: radius.card, paddingHorizontal: space.l, paddingVertical: space.m },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center" as const, justifyContent: "center" as const },
  text: { flex: 1, gap: 2 },
  title: { ...typography.headline },
  detail: { ...typography.footnote, opacity: 0.9 },
}));
