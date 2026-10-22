// Durum rozeti: ikon + metin + zemin + renk (dörtlü; renk körü de okur). Değer sözlükten (`lib/labels`),
// bilinmeyen değer ham etiketle "bilgi" tonunda çizilir.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import { statusEntry } from "../lib/labels";
import { makeStyles, useTokens } from "./theme-context";
import { FONT_SCALE, radius, space, typography, type StatusKind } from "./tokens";

export type StatusBadgeProps =
  | { readonly value: string; readonly kind?: undefined; readonly label?: undefined; readonly size?: "sm" | "md"; readonly testID?: string }
  | { readonly kind: StatusKind; readonly label: string; readonly value?: undefined; readonly size?: "sm" | "md"; readonly testID?: string };

export function StatusBadge(p: StatusBadgeProps) {
  const t = useTokens();
  const s = useStyles();
  const entry = p.kind ? { label: p.label, tone: p.kind } : statusEntry(p.value);
  const c = t.status[entry.tone];
  const sm = p.size === "sm";
  return (
    <View
      style={[s.badge, { backgroundColor: c.bg }, sm && s.sm]}
      testID={p.testID}
      accessible
      accessibilityLabel={`Durum: ${entry.label}`}
    >
      <Ionicons name={c.icon} size={sm ? 12 : 14} color={c.fill} />
      <Text style={[s.text, { color: c.text }]} maxFontSizeMultiplier={FONT_SCALE.title}>
        {entry.label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  badge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: space.xs,
    alignSelf: "flex-start" as const,
    borderRadius: radius.chip,
    paddingHorizontal: space.s + 2,
    paddingVertical: 3,
  },
  sm: { paddingHorizontal: space.s, paddingVertical: 2 },
  text: { ...typography.footnote, fontWeight: "600" as const },
}));
