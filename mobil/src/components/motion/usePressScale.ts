import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { springs } from '../../theme/motion';

/**
 * Basıldığında içeriği yaylı şekilde küçülten press-scale yardımcısı.
 *
 * `PressableScale` mevcut bir TouchableRipple'ı sarmak yerine, bu hook zaten
 * yapısı olan (örn. `<Surface><TouchableRipple>…`) satır/kart bileşenlerine
 * minimal eklenir: dönen `style`'ı dış `Animated.View`/`Reanimated.View`'e,
 * `onPressIn`/`onPressOut`'u içteki TouchableRipple'a bağla. Ripple + tüm-alan
 * dokunma korunur; sadece üstüne fiziksel "basış" derinliği gelir.
 *
 * `useReducedMotion` aktifse scale uygulanmaz.
 *
 * Kullanım:
 *   const press = usePressScale();
 *   <Animated.View style={press.style}>
 *     <Surface …>
 *       <TouchableRipple onPress={…} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
 */
export function usePressScale(scaleTo = 0.97) {
  const scale = useSharedValue(1);
  const reduced = useReducedMotion();

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = () => {
    if (!reduced) scale.value = withSpring(scaleTo, springs.press);
  };
  const onPressOut = () => {
    if (!reduced) scale.value = withSpring(1, springs.press);
  };

  return { style, onPressIn, onPressOut };
}
