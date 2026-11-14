// Pano düzenleyici (alt sayfa): görünen kutular sırasıyla (yukarı/aşağı, çıkar) + eklenebilir kutular (ekle) +
// "Varsayılana dön". Sürükle-bırak yerine düğmeler: el terminalinde ve eldivenle de güvenilir.
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, typography } from "../tokens";
import type { KatalogKutusu, PanoDuzeni } from "./duzen";

export function PanoDuzenleyici({ visible, onClose, katalog, duzen }: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly katalog: readonly KatalogKutusu[];
  readonly duzen: PanoDuzeni;
}) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const byKey = new Map(katalog.map((k) => [k.anahtar, k]));
  const shown = duzen.kutular.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
  const rest = katalog.filter((k) => !duzen.kutular.includes(k.anahtar));
  const act = (fn: () => void) => () => {
    haptic("selection");
    fn();
  };
  const iconBtn = (icon: "chevron-up" | "chevron-down" | "remove-circle" | "add-circle", label: string, onPress: () => void, testID: string, disabled = false, tone?: string) => (
    <Pressable onPress={act(onPress)} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} testID={testID} hitSlop={4} style={({ pressed }) => [s.icon, pressed && { backgroundColor: t.surfaceAlt }, disabled && { opacity: 0.3 }]}>
      <Ionicons name={icon} size={22} color={tone ?? t.textSecondary} />
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={[s.scrim, { backgroundColor: t.navy, opacity: t.scheme === "dark" ? 0.7 : 0.4 }]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Kapat" />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.m }]} accessibilityViewIsModal testID="pano-duzenleyici">
          <View style={s.grabber} />
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={FONT_SCALE.title}>Panoyu düzenle</Text>
            {!duzen.varsayilanMi ? (
              <Pressable onPress={act(duzen.sifirla)} accessibilityRole="button" testID="pano-varsayilan" hitSlop={6} style={s.reset}>
                <Text style={[s.resetText, { color: t.tint }]}>Varsayılana dön</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Bitti" testID="pano-duzen-bitti" style={s.close}>
              <Ionicons name="close" size={20} color={t.textSecondary} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={s.body}>
            <Text style={s.section}>{`Panoda (${shown.length})`}</Text>
            <View style={s.group}>
              {shown.length === 0 ? <Text style={s.emptyText}>Panoda kutu yok; aşağıdan ekleyin.</Text> : null}
              {shown.map((k, i) => (
                <View key={k.anahtar} style={[s.row, i > 0 && s.sep]} testID={`duzen-${k.anahtar}`}>
                  <Text style={s.rowText} numberOfLines={1}>{k.baslik}</Text>
                  {iconBtn("chevron-up", `${k.baslik} yukarı`, () => duzen.tasi(k.anahtar, -1), `yukari-${k.anahtar}`, i === 0)}
                  {iconBtn("chevron-down", `${k.baslik} aşağı`, () => duzen.tasi(k.anahtar, 1), `asagi-${k.anahtar}`, i === shown.length - 1)}
                  {iconBtn("remove-circle", `${k.baslik} çıkar`, () => duzen.cikar(k.anahtar), `cikar-${k.anahtar}`, false, t.status.kritik.fill)}
                </View>
              ))}
            </View>
            {rest.length > 0 ? (
              <>
                <Text style={s.section}>Eklenebilir</Text>
                <View style={s.group}>
                  {rest.map((k, i) => (
                    <Pressable key={k.anahtar} onPress={act(() => duzen.ekle(k.anahtar))} accessibilityRole="button" accessibilityLabel={`${k.baslik} ekle`} testID={`ekle-${k.anahtar}`} style={({ pressed }) => [s.row, i > 0 && s.sep, pressed && { backgroundColor: t.surfaceAlt }]}>
                      <View style={s.flex}>
                        <Text style={s.rowText} numberOfLines={1}>{k.baslik}</Text>
                        {k.aciklama ? <Text style={s.rowSub} numberOfLines={2}>{k.aciklama}</Text> : null}
                      </View>
                      <Ionicons name="add-circle" size={22} color={t.status.iyi.fill} />
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  backdrop: { flex: 1, justifyContent: "flex-end" as const },
  scrim: { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: t.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.l,
    paddingTop: space.s,
    maxHeight: "85%" as const,
    width: "100%" as const,
    maxWidth: 600,
    alignSelf: "center" as const,
    ...t.floatShadow,
  },
  grabber: { alignSelf: "center" as const, width: 36, height: 5, borderRadius: 3, backgroundColor: t.separator, marginBottom: space.s },
  head: { flexDirection: "row" as const, alignItems: "center" as const, minHeight: TOUCH, gap: space.s },
  title: { ...typography.headline, color: t.text, flex: 1 },
  reset: { minHeight: TOUCH, justifyContent: "center" as const },
  resetText: { ...typography.subhead, fontWeight: "600" as const },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: t.surfaceAlt },
  body: { paddingBottom: space.m },
  section: { ...typography.caption, color: t.textMuted, marginTop: space.m, marginBottom: space.xs },
  group: { backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner },
  row: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, paddingLeft: space.m, paddingRight: space.xs, gap: space.xs },
  sep: { borderTopWidth: 1, borderTopColor: t.separator },
  flex: { flex: 1, paddingVertical: space.xs },
  rowText: { ...typography.body, color: t.text, flex: 1 },
  rowSub: { ...typography.footnote, color: t.textSecondary },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const },
  emptyText: { ...typography.callout, color: t.textSecondary, padding: space.m },
}));
