// =============================================================================
// Hareket (motion) token'ları — tüm animasyonlar aynı zamanlama/yay hissini
// paylaşsın diye tek kaynak.
//
// Reanimated v4 (UI thread, 60fps) tabanlı. Süre/easing/spring değerleri burada;
// `src/components/motion/*` primitifleri ve ekranlar buradan okur. Böylece
// uygulama genelinde tutarlı, "tasarlanmış" bir his oluşur — her ekran kendi
// rastgele süresini uydurmaz.
// =============================================================================

import { Easing, ReduceMotion } from 'react-native-reanimated';

/** Süreler (ms). */
export const durations = {
  instant: 120,
  fast: 180,
  base: 260,
  slow: 360,
  slower: 480,
} as const;

/** Easing eğrileri — Material "standard" hareket dili. */
export const easing = {
  /** Giren+çıkan, genel amaçlı. */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** Ekrana giren (yavaşlayarak durur). */
  decelerate: Easing.out(Easing.cubic),
  /** Ekrandan çıkan (hızlanarak gider). */
  accelerate: Easing.in(Easing.cubic),
  /** Loop / nabız için yumuşak gidiş-dönüş. */
  inOut: Easing.inOut(Easing.ease),
  linear: Easing.linear,
} as const;

/**
 * Spring presetleri (withSpring config).
 * - press: dokunma geri tepmesi — hızlı, minimal salınım
 * - gentle: kart/panel girişleri — yumuşak yerleşme
 * - bouncy: başarı/vurgu anları — hafif zıplama
 */
export const springs = {
  press: { mass: 0.5, damping: 18, stiffness: 320 },
  gentle: { mass: 1, damping: 18, stiffness: 160 },
  bouncy: { mass: 0.7, damping: 12, stiffness: 200 },
} as const;

export { ReduceMotion };

/** Liste/grid stagger gecikmesi (ms) — index'e göre kademeli giriş. */
export function staggerDelay(index: number, step = 45, base = 0): number {
  return base + index * step;
}
