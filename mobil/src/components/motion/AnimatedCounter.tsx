import React, { useEffect } from 'react';
import { TextInput } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { durations } from '../../theme/motion';

// TextInput'in `text` prop'unu UI thread'den güncelleyebilmek için whitelist.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface Props {
  value: number;
  /** Geçiş süresi (ms). Default 600. */
  duration?: number;
  /** Sayıyı formatlama (örn. binlik ayraç). Default Math.round. */
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
}

/**
 * Sayıyı eski değerden yeniye yumuşakça sayarak geçiren metin. KPI/sayaç
 * rozetlerinde "23 → 24" anında zıplamak yerine akar. Reanimated'in TextInput
 * `text` prop trick'i ile UI thread'de çalışır (re-render yok).
 * `useReducedMotion` aktifse anında son değere atlar.
 */
export default function AnimatedCounter({
  value,
  duration = durations.slower + 120,
  format = (n) => String(Math.round(n)),
  style,
}: Props) {
  const v = useSharedValue(value);
  const reduced = useReducedMotion();

  useEffect(() => {
    v.value = reduced
      ? value
      : withTiming(value, { duration, easing: Easing.out(Easing.cubic) });
  }, [value, reduced, duration, v]);

  const animatedProps = useAnimatedProps(() => {
    const txt = format(v.value);
    return { text: txt, defaultValue: txt } as never;
  });

  return (
    <AnimatedTextInput
      editable={false}
      underlineColorAndroid="transparent"
      // eslint-disable-next-line react-native/no-inline-styles
      style={[
        { padding: 0, margin: 0, includeFontPadding: false, textAlignVertical: 'center' },
        style,
      ]}
      animatedProps={animatedProps}
    />
  );
}
