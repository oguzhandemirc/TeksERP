import React, { useCallback, useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Portal } from 'react-native-paper';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AppModalPosition = 'center' | 'bottom' | 'right';

export interface AppModalProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  /** İçerik kutusu (sheet) stili — genelde { width, height } + görsel sheet stili. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Backdrop / geri tuşu ile kapanabilsin mi (default true). */
  dismissable?: boolean;
  /** Yerleşim + animasyon: center=fade, bottom=alttan slide, right=sağdan slide. */
  position?: AppModalPosition;
  /** Kapanış animasyonu BİTTİĞİNDE çağrılır — eski react-native-modal `onModalHide`
   *  karşılığı. Gecikmeli aksiyonlar (ör. kapandıktan sonra başka modal açma,
   *  tarama sonucunu resolve etme) burada güvenle yapılır. */
  onHidden?: () => void;
}

// =============================================================================
// AppModal — uygulama geneli modal primitifi. react-native-paper Portal (z-order)
// + react-native-reanimated (animasyon) üzerine kuruludur. react-native-modal'ı
// TAMAMEN değiştirir.
//
// NEDEN react-native-modal değil: @14-rc, New Architecture/Fabric'te backdrop ile
// içeriği ayrı animasyonlarla sürüyor; kapanışta desenkron olup "perde kapan→aç→
// kapan" flicker'ı yapıyordu. Burada TEK `progress` shared value hem backdrop'u
// hem içeriği sürer → ikisi her zaman senkron, flicker yapısal olarak imkânsız.
//
// NEDEN Portal: ağaç-içi render (ayrı native pencere YOK) → modal üstüne modal /
// drawer stack çakışması olmaz, edge-to-edge backdrop boşluğu olmaz. Kök App.tsx'te
// PaperProvider var, Portal.Host hazır.
// =============================================================================
const IN_MS = 200;
const OUT_MS = 170;

export default function AppModal({
  visible,
  onDismiss,
  children,
  contentStyle,
  dismissable = true,
  position = 'center',
  onHidden,
}: AppModalProps) {
  // `rendered`: çıkış animasyonu bitene kadar Portal mount'ta kalır (yoksa içerik
  // anında kaybolur, kapanış animasyonu hiç oynamaz).
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(0);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const finishHide = useCallback(() => {
    setRendered(false);
    onHidden?.();
  }, [onHidden]);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      progress.value = withTiming(1, { duration: IN_MS, easing: Easing.out(Easing.cubic) });
    } else {
      progress.value = withTiming(
        0,
        { duration: OUT_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(finishHide)();
        },
      );
    }
    // progress/finishHide kararlı; sadece visible geçişinde çalışmalı.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Android donanım geri tuşu — açıkken kapatır (dismissable ise).
  useEffect(() => {
    if (!visible || !dismissable) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, dismissable, onDismiss]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value * 0.5 }));

  const contentAnimStyle = useAnimatedStyle(() => {
    const p = progress.value;
    if (position === 'bottom') {
      return { opacity: 1, transform: [{ translateY: (1 - p) * height }] };
    }
    if (position === 'right') {
      return { opacity: 1, transform: [{ translateX: (1 - p) * width }] };
    }
    // center
    return { opacity: p, transform: [{ scale: 0.97 + p * 0.03 }] };
  });

  if (!rendered) return null;

  // bottom/right edge-to-edge: sheet/drawer kendi safe-area padding'ini yönetir
  // (numpad paddingBottom, drawer paddingTop insets.top+8). AppModal burada inset
  // EKLEMEZ — eklerse çift sayılır. Yalnız center, diyalogu çubuk/çentik altından
  // kurtarmak için inset padding alır.
  const wrapperPos =
    position === 'bottom'
      ? {
          // Alttan tam-genişlik sheet (numpad vb). Sheet kendi width verirse o kazanır.
          justifyContent: 'flex-end' as const,
          alignItems: 'stretch' as const,
        }
      : position === 'right'
        ? {
            // Sağ kenarda tam-yükseklik drawer. stretch → içerik dikeyde dolar
            // (drawer sheet height:'100%' bunun üstünde çalışır).
            flexDirection: 'row' as const,
            justifyContent: 'flex-end' as const,
            alignItems: 'stretch' as const,
          }
        : {
            justifyContent: 'center' as const,
            alignItems: 'center' as const,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          };

  // Center: kendi width'ini VERMEYEN sheet'lere makul varsayılan genişlik. Eski
  // react-native-modal varsayılan alignItems:'stretch' ile sheet'i tam genişliğe
  // yayıyordu; AppModal center'da alignItems:'center' olduğundan width'siz sheet
  // içeriğe büzülüp bozuluyordu (uzun boş beyaz kutu).
  //
  // İKİ KULLANIM, İKİ DAVRANIŞ:
  // - contentStyle VERİLMİŞ → modal genişliği dış sarmalayıcıda ayarlar (PickerModal,
  //   BarcodeScannerModal vb.). contentStyle.width contentBase'i override eder, çocuk
  //   stretch ile dolar. alignItems'a dokunma.
  // - contentStyle YOK → modal kendi genişliğini İÇTEKİ View'da verir (ör. winW*0.85).
  //   Sarmalayıcı varsayılan width alır ama `alignItems:'center'` ile içteki View'ı
  //   YATAYDA ORTALAR. Böylece View sarmalayıcıdan geniş (tablet yatay → taşma) ya da
  //   dar (sola yaslanma) olsa bile simetrik kalıp ekran ortasına gelir. Bu olmadan
  //   flex varsayılanı (explicit width'li çocuk = flex-start) modalı kenara kaydırıyordu.
  const contentBase =
    position === 'center'
      ? contentStyle
        ? { width: Math.min(width - 32, 560) }
        : { width: Math.min(width - 32, 560), alignItems: 'center' as const }
      : undefined;

  return (
    <Portal>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          disabled={!dismissable}
          onPress={dismissable ? onDismiss : undefined}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
        />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, wrapperPos]}
      >
        <Animated.View style={[contentBase, contentAnimStyle, contentStyle]}>
          {children}
        </Animated.View>
      </Animated.View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
});
