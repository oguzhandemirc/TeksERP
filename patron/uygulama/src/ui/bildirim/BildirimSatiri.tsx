// Bildirim satırı — bulut "Geçmiş" (`NotificationHistory`) ve ERP gelen bildirimleri AYNI biçimi çizer: tür ikonu ·
// başlık · metin · rozet + zaman; dokunulabilirse basılı zemin, yol varsa ok.
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { KindLabel } from "../../lib/labels/diger";
import { IconChip } from "../IconChip";
import { makeStyles, useTokens } from "../theme-context";
import { space, typography } from "../tokens";

export function BildirimSatiri(p: {
  readonly look: KindLabel;
  readonly title: string;
  readonly body: string;
  readonly badge: ReactNode;
  readonly time: string;
  readonly onPress?: () => void;
  readonly chevron?: boolean;
  readonly accessibilityRole?: "link" | "button";
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}) {
  const t = useTokens();
  const s = useStyles();
  return (
    <Pressable disabled={!p.onPress} onPress={p.onPress} accessibilityRole={p.onPress ? p.accessibilityRole : undefined} accessibilityLabel={p.accessibilityLabel} testID={p.testID}
      style={({ pressed }) => [s.hist, pressed && p.onPress ? { backgroundColor: t.surfaceAlt } : null]}>
      <IconChip domain={p.look.domain} icon={p.look.icon} size={36} />
      <View style={s.flex}>
        <Text style={s.histTitle}>{p.title}</Text>
        <Text style={s.histBody}>{p.body}</Text>
        <View style={s.histMeta}>
          {p.badge}
          <Text style={s.histTime}>{p.time}</Text>
        </View>
      </View>
      {p.chevron ? <Ionicons name="chevron-forward" size={18} color={t.textMuted} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  flex: { flex: 1, minWidth: 0 },
  hist: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  histTitle: { ...typography.headline, color: t.text },
  histBody: { ...typography.subhead, color: t.textSecondary, marginTop: 2 },
  histMeta: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s, marginTop: space.s, flexWrap: "wrap" as const },
  histTime: { ...typography.footnote, color: t.textMuted },
}));
