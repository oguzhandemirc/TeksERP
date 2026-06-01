import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { durations } from '../../theme/motion';

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
 * rozetlerinde "23 → 24" anında zıplamak yerine akar.
 *
 * Animasyon UI thread'de (reanimated shared value) yürür; her ara değer
 * `useAnimatedReaction` + `runOnJS` ile JS thread'e taşınıp normal `<Text>`
 * olarak çizilir. `useReducedMotion` aktifse anında son değere atlar.
 *
 * NOT (New Architecture / Fabric — özellikle iPad): Eski sürüm `AnimatedTextInput`
 * üzerinde `text` prop'unu UI thread'den animasyonluyor ve worklet İÇİNDE harici
 * (worklet-olmayan) `format` fonksiyonunu çağırıyordu. İkisi de Fabric'te
 * "non-worklet function on UI thread" → uygulamayı tamamen kapatan native crash
 * yapıyordu. Bu yüzden `format` artık YALNIZCA JS thread'de uygulanır; worklet
 * sadece `Math.round` yapar.
 */
export default function AnimatedCounter({
  value,
  duration = durations.slower + 120,
  format = (n) => String(Math.round(n)),
  style,
}: Props) {
  const v = useSharedValue(value);
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(() => format(value));

  // format'ı JS thread'de uygula — worklet içinde çağırmak Fabric'te crash eder.
  const applyFormat = useCallback((n: number) => setDisplay(format(n)), [format]);

  useEffect(() => {
    if (reduced) {
      v.value = value;
      setDisplay(format(value));
      return;
    }
    v.value = withTiming(value, { duration, easing: Easing.out(Easing.cubic) });
  }, [value, reduced, duration, v, format]);

  useAnimatedReaction(
    () => Math.round(v.value),
    (curr, prev) => {
      if (curr !== prev) runOnJS(applyFormat)(curr);
    },
    [applyFormat],
  );

  return <Text style={style}>{display}</Text>;
}
