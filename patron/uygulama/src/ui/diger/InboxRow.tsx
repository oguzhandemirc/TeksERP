// Gelen kutusu satırı: tür ikon çipi · tür adı + gövde özeti + gönderen · sağda durum rozeti ve yaş.
// 24 saati geçen bekleyen talep uyarı rengiyle (saat ikonu + metin; renk tek başına anlam taşımaz).
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, Text, View } from "react-native";
import type { InboxItem } from "../../api/wire";
import { formatAgo } from "../../lib/format";
import { statusEntry } from "../../lib/labels";
import { inboxKind } from "../../lib/labels/diger";
import { IconChip } from "../IconChip";
import { StatusBadge } from "../StatusBadge";
import { makeStyles, useTokens } from "../theme-context";
import { space, typography } from "../tokens";
import { inboxOverdue, inboxSummary } from "./inbox-format";

export function InboxRow({ m, onPress, showAuthor }: { readonly m: InboxItem; readonly onPress: () => void; readonly showAuthor?: boolean }) {
  const t = useTokens();
  const s = useStyles();
  const kind = inboxKind(m.tur);
  const late = inboxOverdue(m);
  const age = formatAgo(m.olusturulma);
  const summary = inboxSummary(m);
  return (
    <Pressable
      onPress={onPress}
      testID={`mesaj-${m.mesajId}`}
      accessibilityRole="button"
      accessibilityLabel={[kind.ad, summary, statusEntry(m.durum).label, age, late ? "24 saattir bekliyor" : null].filter(Boolean).join(", ")}
      style={({ pressed }) => [s.row, pressed && { backgroundColor: t.surfaceAlt }]}
    >
      <IconChip domain={kind.domain} icon={kind.icon} size={40} />
      <View style={s.text}>
        <Text style={s.title} numberOfLines={1}>{kind.ad}</Text>
        <Text style={s.summary} numberOfLines={2}>{summary}</Text>
        {showAuthor ? <Text style={s.meta} numberOfLines={1}>{m.hesapAdi}</Text> : null}
      </View>
      <View style={s.side}>
        <StatusBadge value={m.durum} size="sm" />
        <View style={s.ageRow}>
          {late ? <Ionicons name="time" size={13} color={t.status.uyari.fill} /> : null}
          <Text style={[s.age, late && { color: t.status.uyari.fill, fontWeight: "600" }]} numberOfLines={1}>{age}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { minHeight: 72, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  text: { flex: 1, minWidth: 0 },
  title: { ...typography.headline, color: t.text },
  summary: { ...typography.subhead, color: t.textSecondary, marginTop: 1 },
  meta: { ...typography.footnote, color: t.textMuted, marginTop: 2 },
  side: { alignItems: "flex-end" as const, gap: space.xs, maxWidth: "40%" as const },
  ageRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3 },
  age: { ...typography.footnote, color: t.textMuted },
}));
