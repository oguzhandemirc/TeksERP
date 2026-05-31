import React, { useEffect } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius as R } from '../../theme/tokens';

interface Props {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Yükleniyor placeholder'ı — opaklığı nefes alan iskelet blok. Liste/kart
 * yüklenirken boş ekran veya tek spinner yerine içeriğin şeklini gösterir
 * (algılanan hızı artırır). `useReducedMotion` aktifse sabit blok.
 */
export default function Skeleton({
  width = '100%',
  height = 16,
  radius = R.sm,
  style,
}: Props) {
  const p = useSharedValue(0.5);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!reduced) {
      p.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }
    return () => cancelAnimation(p);
  }, [reduced, p]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0.7 : 0.4 + p.value * 0.4,
  }));

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: colors.surfaceSunken },
        animatedStyle,
        style,
      ]}
    />
  );
}
