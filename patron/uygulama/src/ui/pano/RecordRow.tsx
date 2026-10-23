// Kayıt satırı (Posta tarzı): ikon çipi · [başlık ……… sağda değer ya da rozet] · altta tam genişlik alt satırlar · chevron.
// `ListRow`da rozet + değer metin sütununu daraltıp alt metni kırpıyordu; burada rozet yalnız başlıkla yarışır.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { IconName } from "../icons";
import { IconChip } from "../IconChip";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, space, tabularNums, typography, type Domain } from "../tokens";

export function RecordRow(p: {
  readonly title: string;
  /** Sağ üstte: metre gibi değer… */
  readonly value?: string;
  /** …ya da durum rozeti. */
  readonly badge?: ReactNode;
  readonly lines: readonly string[];
  readonly domain: Domain;
  readonly icon?: IconName;
  readonly onPress?: () => void;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}) {
  const t = useTokens();
  const s = useStyles();
  const body = (
    <>
      <IconChip domain={p.domain} icon={p.icon} size={36} />
      <View style={s.text}>
        <View style={s.top}>
          <Text style={s.title} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.body}>{p.title}</Text>
          {p.value ? <Text style={s.value} numberOfLines={1}>{p.value}</Text> : null}
          {p.badge}
        </View>
        {p.lines.map((l, i) => (
          <Text key={i} style={s.line} numberOfLines={1}>{l}</Text>
        ))}
      </View>
      {p.onPress ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
    </>
  );
  const label = p.accessibilityLabel ?? [p.title, p.value, ...p.lines].filter(Boolean).join(", ");
  if (!p.onPress) return <View style={s.row} testID={p.testID} accessible accessibilityLabel={label}>{body}</View>;
  return (
    <Pressable onPress={p.onPress} testID={p.testID} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surfaceAlt }]}>
      {body}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { minHeight: 64, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  text: { flex: 1, gap: 2 },
  top: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  title: { ...typography.headline, color: t.text, flex: 1 },
  value: { ...typography.callout, ...tabularNums, fontWeight: "600" as const, color: t.text },
  line: { ...typography.subhead, color: t.textSecondary },
}));
