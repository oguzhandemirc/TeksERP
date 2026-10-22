// Segment denetimi: kapsül iz, seçili parça opak kart; 2–4 seçenekte gösterge yayla kayar, 5+ seçenekte yatay
// kaydırılan çip dizisi olur (dar telefonda sığsın). Seçim değişince hafif dokunsal geri bildirim.
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { haptic } from "./haptics";
import { durations, springs } from "./motion";
import { makeStyles, useReducedMotion, useTokens } from "./theme-context";
import { FONT_SCALE, TOUCH, radius, space, typography } from "./tokens";

export interface SegmentItem<K extends string> {
  readonly key: K;
  readonly label: string;
}

export interface SegmentedControlProps<K extends string> {
  readonly items: readonly SegmentItem<K>[];
  readonly value: K;
  readonly onChange: (k: K) => void;
  /** Her parçanın testID'si `${testIDPrefix}${key}` (varsayılan `segment-`). */
  readonly testIDPrefix?: string;
  readonly accessibilityLabel?: string;
}

const PAD = 3;

export function SegmentedControl<K extends string>({ items, value, onChange, testIDPrefix = "segment-", accessibilityLabel }: SegmentedControlProps<K>) {
  const t = useTokens();
  const s = useStyles();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const scroll = items.length > 4;
  const index = Math.max(0, items.findIndex((i) => i.key === value));
  const segW = items.length > 0 && width > 0 ? (width - PAD * 2) / items.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    const to = index * segW;
    x.value = reduced ? withTiming(to, { duration: durations.instant }) : withSpring(to, springs.press);
  }, [index, segW, reduced, x]);

  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const select = (k: K) => {
    if (k === value) return;
    haptic("selection");
    onChange(k);
  };

  const parts = items.map((i) => {
    const on = i.key === value;
    return (
      <Pressable
        key={i.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => select(i.key)}
        testID={`${testIDPrefix}${i.key}`}
        style={[s.part, scroll ? [s.chip, on && { backgroundColor: t.surface }] : s.flex]}
      >
        <Text style={[s.text, on && s.textOn]} numberOfLines={1} maxFontSizeMultiplier={FONT_SCALE.title}>
          {i.label}
        </Text>
      </Pressable>
    );
  });

  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} contentContainerStyle={s.track}>
        {parts}
      </ScrollView>
    );
  }
  return (
    <View style={s.track} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {segW > 0 ? <Animated.View pointerEvents="none" style={[s.indicator, { width: segW }, indicator]} /> : null}
      {parts}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  track: {
    flexDirection: "row" as const,
    backgroundColor: t.scheme === "dark" ? t.surfaceAlt : t.separator,
    borderRadius: radius.control,
    padding: PAD,
    gap: 0,
  },
  indicator: {
    position: "absolute" as const,
    top: PAD,
    bottom: PAD,
    left: PAD,
    borderRadius: radius.control - PAD,
    backgroundColor: t.surface,
    ...t.cardShadow,
  },
  part: { minHeight: TOUCH - 8, alignItems: "center" as const, justifyContent: "center" as const, paddingHorizontal: space.s },
  flex: { flex: 1 },
  chip: { minWidth: 88, borderRadius: radius.control - PAD, paddingHorizontal: space.m },
  text: { ...typography.subhead, color: t.textSecondary },
  textOn: { color: t.text, fontWeight: "600" as const },
}));
