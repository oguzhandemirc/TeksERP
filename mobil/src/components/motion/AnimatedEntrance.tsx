import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useReducedMotion,
} from 'react-native-reanimated';
import { staggerDelay } from '../../theme/motion';

type Direction = 'up' | 'down' | 'fade';

interface Props {
  /** Liste/grid içindeyse sıra — kademeli (stagger) giriş için. */
  index?: number;
  /** Ek baz gecikme (ms). */
  delay?: number;
  /** index başına gecikme adımı (ms). Default 45. */
  step?: number;
  /** 'up' = aşağıdan yukarı kayar (default), 'down' = yukarıdan, 'fade' = sadece opaklık. */
  direction?: Direction;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * İçeriği ekrana yumuşak, yaylı bir girişle taşır — listelerde `index` ile
 * kademeli (stagger) akış oluşturur. Reanimated layout animasyonu (UI thread).
 * `useReducedMotion` aktifse animasyon atlanır, içerik anında görünür.
 */
export default function AnimatedEntrance({
  index = 0,
  delay = 0,
  step = 45,
  direction = 'up',
  style,
  children,
}: Props) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <Animated.View style={style}>{children}</Animated.View>;
  }

  const total = delay + staggerDelay(index, step);
  const base =
    direction === 'up' ? FadeInDown : direction === 'down' ? FadeInUp : FadeIn;
  const entering = base
    .delay(total)
    .springify()
    .damping(16)
    .stiffness(180)
    .mass(0.7);

  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
