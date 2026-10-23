// Süzgeç çipinin açtığı alt sayfa: tek seçim, seçili satırda onay işareti (combobox yok; çip DOĞRUDAN bunu açar).
import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "../haptics";
import { makeStyles, useTokens } from "../theme-context";
import { FONT_SCALE, TOUCH, radius, space, typography } from "../tokens";

export interface Choice<K extends string> {
  readonly key: K;
  readonly label: string;
}

export function ChoiceSheet<K extends string>(p: {
  readonly visible: boolean;
  readonly title: string;
  readonly choices: readonly Choice<K>[];
  readonly value: K;
  readonly onSelect: (k: K) => void;
  readonly onClose: () => void;
  /** Satır testID'si `${testIDPrefix}${key}`. */
  readonly testIDPrefix: string;
}) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={p.visible} transparent animationType="fade" onRequestClose={p.onClose}>
      <View style={s.backdrop}>
        <Pressable style={[s.scrim, { backgroundColor: t.navy, opacity: t.scheme === "dark" ? 0.7 : 0.4 }]} onPress={p.onClose} accessibilityRole="button" accessibilityLabel="Kapat" testID={`${p.testIDPrefix}kapat`} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + space.l }]} accessibilityViewIsModal>
          <View style={s.grabber} />
          <View style={s.head}>
            <Text style={s.title} accessibilityRole="header" maxFontSizeMultiplier={FONT_SCALE.title}>{p.title}</Text>
            <Pressable onPress={p.onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Kapat" style={s.close}>
              <Ionicons name="close" size={20} color={t.textSecondary} />
            </Pressable>
          </View>
          <ScrollView style={s.list} contentContainerStyle={s.listInner}>
            {p.choices.map((c, i) => {
              const on = c.key === p.value;
              return (
                <Pressable
                  key={c.key}
                  testID={`${p.testIDPrefix}${c.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    haptic("selection");
                    p.onSelect(c.key);
                    p.onClose();
                  }}
                  style={({ pressed }) => [s.row, i > 0 && s.rowSep, pressed && { backgroundColor: t.surfaceAlt }]}
                >
                  <Text style={[s.rowText, on && { color: t.tint, fontWeight: "600" }]}>{c.label}</Text>
                  {on ? <Ionicons name="checkmark" size={20} color={t.tint} /> : null}
                </Pressable>
              );
            })}
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
    maxHeight: "80%" as const,
    width: "100%" as const,
    maxWidth: 560,
    alignSelf: "center" as const,
    ...t.floatShadow,
  },
  grabber: { alignSelf: "center" as const, width: 36, height: 5, borderRadius: 3, backgroundColor: t.separator, marginBottom: space.s },
  head: { flexDirection: "row" as const, alignItems: "center" as const, minHeight: TOUCH },
  title: { ...typography.headline, color: t.text, flex: 1 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: t.surfaceAlt },
  list: { backgroundColor: t.surfaceAlt, borderRadius: radius.cardInner },
  listInner: { paddingVertical: space.xs },
  row: { minHeight: TOUCH, flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: space.l, gap: space.m },
  rowSep: { borderTopWidth: 1, borderTopColor: t.separator },
  rowText: { ...typography.body, color: t.text, flex: 1 },
}));
