// Büyük başlık → küçülen başlık (iOS düzeni): içerikteki 34 pt başlık kaydırınca solar, üst bardaki 17 pt başlık
// ve ince alt çizgi belirir. Kaydırma değeri `useHeaderScroll` ile ekranın kaydırıcısından gelir (UI iş parçacığı).
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { makeStyles, useTokens } from "./theme-context";
import { BAR_HEIGHT, FONT_SCALE, TOUCH, space, typography } from "./tokens";

/** Başlığın tamamen küçüldüğü kaydırma mesafesi (büyük başlık satır yüksekliği). */
export const COLLAPSE_AT = 41;

export function useHeaderScroll(): { scrollY: SharedValue<number>; onScroll: ReturnType<typeof useAnimatedScrollHandler> } {
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });
  return { scrollY, onScroll };
}

/** Üst bar: geri düğmesi · küçük başlık (kaydırınca belirir) · sağ yuva. */
export function LargeHeader({ title, scrollY, topInset, onBack, right }: {
  readonly title: string;
  readonly scrollY: SharedValue<number>;
  readonly topInset: number;
  readonly onBack?: () => void;
  readonly right?: ReactNode;
}) {
  const t = useTokens();
  const s = useStyles();
  const small = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [COLLAPSE_AT * 0.6, COLLAPSE_AT], [0, 1], Extrapolation.CLAMP) }));
  const line = useAnimatedStyle(() => ({ opacity: interpolate(scrollY.value, [0, COLLAPSE_AT], [0, 1], Extrapolation.CLAMP) }));
  return (
    <View style={[s.bar, { paddingTop: topInset }]}>
      <View style={s.inner}>
        <View style={s.side}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Geri" testID="geri" onPress={onBack} style={s.back} hitSlop={4}>
              <Ionicons name="chevron-back" size={24} color={t.tint} />
              <Text style={s.backText}>Geri</Text>
            </Pressable>
          ) : null}
        </View>
        <Animated.Text style={[s.small, small]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.title} importantForAccessibility="no" accessibilityElementsHidden>
          {title}
        </Animated.Text>
        <View style={[s.side, s.right]}>{right}</View>
      </View>
      <Animated.View style={[s.line, line]} />
    </View>
  );
}

/** İçerikteki büyük başlık (ekran okuyucu bunu başlık olarak duyar). */
export function LargeTitle({ title, scrollY, subtitle }: { readonly title: string; readonly scrollY: SharedValue<number>; readonly subtitle?: ReactNode }) {
  const s = useStyles();
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, COLLAPSE_AT * 0.8], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(scrollY.value, [-80, 0], [1.06, 1], Extrapolation.CLAMP) }],
  }));
  return (
    <Animated.View style={[s.large, fade]}>
      <Text style={s.largeText} accessibilityRole="header" numberOfLines={2} maxFontSizeMultiplier={FONT_SCALE.title}>{title}</Text>
      {subtitle}
    </Animated.View>
  );
}

const useStyles = makeStyles((t) => ({
  bar: { backgroundColor: t.bg },
  inner: { height: BAR_HEIGHT, flexDirection: "row" as const, alignItems: "center" as const, paddingHorizontal: space.s },
  side: { minWidth: 88, flexDirection: "row" as const, alignItems: "center" as const },
  right: { justifyContent: "flex-end" as const },
  back: { minHeight: TOUCH, minWidth: TOUCH, flexDirection: "row" as const, alignItems: "center" as const },
  backText: { ...typography.body, color: t.tint },
  small: { ...typography.headline, color: t.text, flex: 1, textAlign: "center" as const },
  line: { height: 1, backgroundColor: t.separator },
  large: { marginBottom: space.m, transformOrigin: "left" as const },
  largeText: { ...typography.largeTitle, color: t.text },
}));
