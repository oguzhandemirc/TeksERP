// Gelen kutusu satırı: tür ikon çipi · üst satırda tür adı + durum rozeti, altında tam genişlikte gövde özeti, en altta
// gönderen · yaş. 24 saati geçen bekleyen talep uyarı rengiyle (saat ikonu + metin; renk tek başına anlam taşımaz).
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
        <View style={s.head}>
          <Text style={s.title} numberOfLines={1}>{kind.ad}</Text>
          <StatusBadge value={m.durum} size="sm" />
        </View>
        <Text style={s.summary} numberOfLines={2}>{summary}</Text>
        <View style={s.metaRow}>
          {showAuthor ? <Text style={s.meta} numberOfLines={1}>{`${m.hesapAdi} · `}</Text> : null}
          {late ? <Ionicons name="time" size={13} color={t.status.uyari.fill} /> : null}
          <Text style={[s.meta, s.age, late && { color: t.status.uyari.fill, fontWeight: "600" }]} numberOfLines={1}>{age}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.textMuted} />
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: { minHeight: 72, flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, paddingHorizontal: space.l, paddingVertical: space.m },
  text: { flex: 1, minWidth: 0 },
  head: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: space.s },
  title: { ...typography.headline, color: t.text, flexShrink: 1 },
  summary: { ...typography.subhead, color: t.textSecondary, marginTop: 2 },
  metaRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 3, marginTop: 3 },
  meta: { ...typography.footnote, color: t.textMuted, flexShrink: 1 },
  age: { flexShrink: 0 },
}));
