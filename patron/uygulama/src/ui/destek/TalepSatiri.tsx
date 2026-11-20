// Taleplerim satırı (tam genişlik liste yüzeyi, iki satır): konu + okunmamış noktası · numara · durum rozeti · son
// hareket; "Firmanın" sekmesinde talebi açan kişi. Okunmamış ekip yanıtı varsa konu kalın ve solda nokta.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text, View } from "react-native";
import type { DestekListeOgesi } from "../../api/destek-wire";
import { durumEtiketi, durumTonu } from "../../destek/metin";
import { formatAgo } from "../../lib/format";
import { Basilabilir } from "./parcalar";
import { Rozet } from "./parcalar";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, space, typography } from "../tokens";

export function DestekDurumRozeti({ durum, testID }: { readonly durum: string; readonly testID?: string }) {
  return <Rozet label={durumEtiketi(durum)} tone={durumTonu(durum)} testID={testID} />;
}

export function TalepSatiri({ talep, kisiGoster, ayrac, onPress, now }: {
  readonly talep: DestekListeOgesi;
  /** "Firmanın" sekmesi: talebi açan kişinin adı. */
  readonly kisiGoster: boolean;
  readonly ayrac: boolean;
  readonly onPress: () => void;
  readonly now?: number;
}) {
  const t = useTokens();
  const s = useStyles();
  const okunmamis = talep.unreadReplies > 0;
  const kisi = kisiGoster ? talep.requester?.name : undefined;
  const ikincil = [talep.number, kisi, formatAgo(talep.lastActivityAt, now)].filter(Boolean).join(" · ");
  return (
    <Basilabilir
      onPress={onPress}
      olcek={1}
      basiliZemin={t.surfaceAlt}
      accessibilityRole="button"
      accessibilityLabel={[okunmamis ? "Okunmamış yanıt" : null, talep.subject, durumEtiketi(talep.status), ikincil].filter(Boolean).join(", ")}
      testID={`talep-${talep.id}`}
      style={[s.satir, ayrac && s.ayrac]}
    >
      <View style={s.nokta}>{okunmamis ? <View style={[s.noktaIc, { backgroundColor: t.tint }]} testID={`talep-${talep.id}-okunmamis`} /> : null}</View>
      <View style={s.metin}>
        <View style={s.ust}>
          <Text style={[s.konu, okunmamis && s.konuKalin]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.title}>{talep.subject}</Text>
          <DestekDurumRozeti durum={talep.status} />
        </View>
        <Text style={s.ikincil} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.title}>{ikincil}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={t.textSecondary} />
    </Basilabilir>
  );
}

const useStyles = makeStyles((t) => ({
  satir: { minHeight: 64 + space.s, flexDirection: "row" as const, alignItems: "center" as const, paddingVertical: space.s, paddingRight: space.s, backgroundColor: t.surface },
  ayrac: { borderTopWidth: 1, borderTopColor: t.separator },
  nokta: { width: space.l, alignItems: "center" as const },
  noktaIc: { width: 8, height: 8, borderRadius: 4 },
  metin: { flex: 1, minWidth: 0, gap: 2 },
  ust: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.s },
  konu: { ...typography.body, color: t.text, flexShrink: 1 },
  konuKalin: { fontWeight: "700" as const },
  ikincil: { ...typography.caption, color: t.textSecondary },
}));
