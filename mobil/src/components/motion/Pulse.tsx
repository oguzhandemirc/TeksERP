import React, { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme/tokens';

interface Props {
  /** Nokta rengi. Default success (yeşil). */
  color?: string;
  /** Nokta çapı (dp). Default 8. */
  size?: number;
  /** Animasyon açık/kapalı. Default true. */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Nabız atan nokta — yayılan halka + nefes alan çekirdek. Canlı/çevrimdışı
 * göstergeleri, "senkron bekliyor", "kamera aktif" gibi durumlar için.
 * `useReducedMotion` aktifse sabit nokta gösterir.
 */
export default function Pulse({
  color = colors.success,
  size = 8,
  active = true,
  style,
}: Props) {
  const p = useSharedValue(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (active && !reduced) {
      p.value = withRepeat(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(p);
      p.value = 0;
    }
    return () => cancelAnimation(p);
  }, [active, reduced, p]);

  const dot = useAnimatedStyle(() => ({
    opacity: 0.55 + p.value * 0.45,
    transform: [{ scale: 1 + p.value * 0.12 }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: (1 - p.value) * 0.45,
    transform: [{ scale: 1 + p.value * 1.7 }],
  }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Animated.View
        style={[
          { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          ring,
        ]}
      />
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          dot,
        ]}
      />
    </Animated.View>
  );
}
