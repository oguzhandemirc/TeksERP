// "Telefon bildirimleri" bölümünün giriş kartı: başlık · izin rozeti · tek satır özet (açık tür sayısı + kısa açıklama) ve
// sağda tek eylem. Eskiden başlık, rozet, düğme ve açıklama ayrı satırlardı; tablette koca boşluk bırakıyordu.
import { Text, View } from "react-native";
import { IconChip } from "../IconChip";
import { Button } from "../kit";
import { StatusBadge } from "../StatusBadge";
import { makeStyles } from "../theme-context";
import { FONT_SCALE, radius, space, typography } from "../tokens";

/** "12/40 tür telefona gelir" — sayılar sunucunun tercih hücrelerinden sayılır (aritmetik değil, sayım). */
export function ozetMetni(acik: number, toplam: number): string {
  if (toplam === 0) return "Hangi bildirimler telefonunuza gelsin? Kapalı olanlar yalnız uygulamadaki listede görünür.";
  return `${acik}/${toplam} tür telefona gelir · kapalılar yalnız uygulamada görünür`;
}

export function TelefonOzeti({ izinVar, acik, toplam, busy, disabled, onAc }: {
  /** `true`: izin verildi (yeniden kaydet); `false`: henüz sorulmadı (aç). */
  readonly izinVar: boolean;
  readonly acik: number;
  readonly toplam: number;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onAc: () => void;
}) {
  const s = useStyles();
  return (
    <View style={s.card} testID="telefon-ozet">
      <IconChip domain="genel" icon="phone-portrait-outline" size={32} />
      <View style={s.body}>
        <View style={s.titleRow}>
          <Text style={s.title} accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.title}>Telefon bildirimleri</Text>
          {izinVar ? <StatusBadge kind="iyi" label="İzin verildi" size="sm" /> : null}
        </View>
        <Text style={s.note} numberOfLines={2} testID="telefon-ozet-metin">
          {izinVar ? ozetMetni(acik, toplam) : "Seçtiğiniz bildirimler uygulama kapalıyken de telefonunuza gelir. Bildirim metni kilit ekranında görünebilir."}
        </Text>
      </View>
      {izinVar ? (
        <Button label="Yeniden kaydet" accessibilityLabel="Bu telefonu yeniden kaydet" tone="plain" icon="refresh-outline" busy={busy} disabled={disabled} onPress={onAc} testID="telefon-bildirim-ac" />
      ) : (
        <Button label="Telefon bildirimlerini aç" icon="notifications-outline" busy={busy} disabled={disabled} onPress={onAc} testID="telefon-bildirim-ac" />
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.m, backgroundColor: t.surface, borderRadius: radius.cardInner, paddingVertical: space.s, paddingHorizontal: space.m, marginBottom: space.m, ...t.cardShadow },
  body: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, columnGap: space.s, rowGap: 2 },
  title: { ...typography.headline, color: t.text },
  note: { ...typography.footnote, color: t.textSecondary },
}));
