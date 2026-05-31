import React, { useCallback } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { TouchableRipple } from 'react-native-paper';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useReducedMotion,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { springs } from '../../theme/motion';

type HapticKind = false | 'light' | 'medium' | 'heavy';

interface Props {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Basışta dokunsal geri bildirim. Default 'light'. false = kapalı. */
  haptic?: HapticKind;
  /** Basılıyken küçülme oranı (0–1). Default 0.96. */
  scaleTo?: number;
  rippleColor?: string;
  borderless?: boolean;
  /** Dış (animasyonlu) sarmalayıcıya uygulanır — layout/flex/gölge/radius buraya. */
  style?: StyleProp<ViewStyle>;
  /** İç TouchableRipple'a uygulanır — dolgu/padding/overflow buraya. */
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  children: React.ReactNode;
}

/**
 * Dokunulabilir alan + ripple (proje kuralı: TouchableRipple) + Reanimated
 * press-spring micro-interaction. Basışta içerik yumuşakça küçülür, bırakınca
 * yaylanarak döner; opsiyonel haptic.
 *
 * Proje kuralına uyumlu: ripple + tüm-alan dokunma TouchableRipple ile sağlanır,
 * scale yalnızca onu saran Animated.View'e uygulanır (dokunmayı yutmaz).
 * `useReducedMotion` aktifse scale devre dışı kalır (erişilebilirlik).
 */
export default function PressableScale({
  onPress,
  onLongPress,
  disabled,
  haptic = 'light',
  scaleTo = 0.96,
  rippleColor,
  borderless = false,
  style,
  contentStyle,
  accessibilityLabel,
  children,
}: Props) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    if (!reduced) scale.value = withSpring(scaleTo, springs.press);
  }, [reduced, scale, scaleTo]);

  const handlePressOut = useCallback(() => {
    if (!reduced) scale.value = withSpring(1, springs.press);
  }, [reduced, scale]);

  const handlePress = useCallback(() => {
    if (haptic) {
      const intensity =
        haptic === 'heavy'
          ? Haptics.ImpactFeedbackStyle.Heavy
          : haptic === 'medium'
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light;
      Haptics.impactAsync(intensity).catch(() => {});
    }
    onPress?.();
  }, [haptic, onPress]);

  return (
    <Animated.View style={[animatedStyle, style]}>
      <TouchableRipple
        onPress={disabled ? undefined : handlePress}
        onLongPress={disabled ? undefined : onLongPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        rippleColor={rippleColor}
        borderless={borderless}
        style={contentStyle}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </TouchableRipple>
    </Animated.View>
  );
}
