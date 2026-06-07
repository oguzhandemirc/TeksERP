import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';
import { Text } from 'react-native-paper';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Kayma hızı (px/sn). Default 35. */
  speed?: number;
  /** Uçlarda bekleme (ms). Default 900. */
  pause?: number;
}

/**
 * Tek satır metin; kabına SIĞMIYORSA otomatik sağa-sola kayar (marquee), sığıyorsa
 * sabit durur. Barkod/kod gibi kesilmemesi (… olmaması) gereken uzun değerler için.
 *
 * Performans: saf `translateX` (Reanimated, UI-thread'de GPU-composited). `scrollTo`
 * KULLANILMAZ — o yaklaşım her barkod için her karede native scroll komutu gönderip
 * (çok sayıda olunca) UI thread'i doldurup sayfayı yavaşlatıyor, dokunmaları
 * düşürüyordu. translateX'te taşmayan barkod hiç animasyon kurmaz (bedava).
 *
 * Ölçüm: clip `flexDirection:'row'` → Text ANA eksende (sınırsız) ölçülür, bu yüzden
 * kesilmez/… olmaz; gerçek genişlik onLayout'la alınır, taşan kısım overflow:'hidden'
 * ile gizlenir. (Kolon kabında Text genişliği kaba sıkışıp kesiliyordu.)
 * `useReducedMotion` aktifse kaymaz. `React.memo` ile gereksiz yeniden render engellenir.
 */
function MarqueeText({ text, style, speed = 35, pause = 900 }: Props) {
  const [containerW, setContainerW] = useState(0);
  const [textW, setTextW] = useState(0);
  const tx = useSharedValue(0);
  const reduced = useReducedMotion();

  const overflow = Math.max(0, Math.ceil(textW - containerW));

  useEffect(() => {
    cancelAnimation(tx);
    tx.value = 0;
    // Yalnız anlamlı taşmada kaydır (1-2px ölçüm gürültüsünü atla).
    if (overflow > 4 && !reduced) {
      const dur = (overflow / speed) * 1000;
      tx.value = withRepeat(
        withSequence(
          withDelay(pause, withTiming(-overflow, { duration: dur, easing: Easing.inOut(Easing.ease) })),
          withDelay(pause, withTiming(0, { duration: dur, easing: Easing.inOut(Easing.ease) })),
        ),
        -1,
        false,
      );
    }
    return () => cancelAnimation(tx);
  }, [overflow, speed, pause, reduced, text, tx]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <View
      style={styles.clip}
      pointerEvents="none"
      onLayout={(e: LayoutChangeEvent) => setContainerW(e.nativeEvent.layout.width)}
    >
      <Animated.View style={animStyle}>
        <Text style={style} numberOfLines={1} onLayout={(e) => setTextW(e.nativeEvent.layout.width)}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

export default React.memo(MarqueeText);

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', flexDirection: 'row' },
});
