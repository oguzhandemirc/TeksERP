import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Portal } from 'react-native-paper';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

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
  /** Sürükleyerek kapatma (bottom/center=aşağı, right=sağa). Default true.
   *  `dismissable=false` ise zaten devre dışıdır. Kritik/zorunlu modallarda kapat. */
  swipeToDismiss?: boolean;
}

// Sürükle-kapat eşikleri.
const DRAG_ZONE = 80; // bottom/center: aşağı çekiş yalnız içeriğin üst bu kadar px'inden başlar
const V_DISMISS_DIST = 120; // dikey: bu kadar px aşılırsa kapan
const V_DISMISS_VEL = 900; // dikey: bu hızı (px/s) aşan fırlatma kapatır
const H_DISMISS_DIST = 100; // yatay (right): bu kadar px aşılırsa kapan
const H_DISMISS_VEL = 800; // yatay: fırlatma hız eşiği
const SPRING_BACK_MS = 160;

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
// NEDEN Portal: ayrı native pencere YOK → modal üstüne modal / drawer stack
// çakışması olmaz, edge-to-edge backdrop boşluğu olmaz. Kök App.tsx'te
// PaperProvider var, Portal.Host hazır.
//
// ⚠️⚠️ İÇERİK BU AĞAÇTA RENDER EDİLMEZ — UYGULAMA CONTEXT'LERİ GÖRÜNMEZ.
// Paper `Portal` çocukları `Portal.Host`a TAŞIR; React context ağaca bağlı
// olduğu için modal içeriği, AppModal'ı çağıran ekranın sağladığı hiçbir
// context'i göremez. Bugüne kadar İKİ kez ısırdı:
//   • `useNavigation()` → portal içinde fırlatır (bkz. navigation/navigationRef.ts)
//   • `useNumpadContext()` → 2026-08-04, Tambur → Düzelt → Manuel Top Ekle:
//     `FATAL EXCEPTION: mqt_v_native` ile uygulama komple çöktü (logcat ile
//     doğrulandı). Çözüm: `NumpadInput` artık `useOptionalNumpadContext` ile
//     okuyor ve provider yoksa sistem klavyesine düşüyor (fail-soft).
// Modal içinde bir hook ekliyorsan ÖNCE sor: bu hook ekranın provider'ına mı
// bakıyor? Bakıyorsa portal içinde ÇALIŞMAZ. Çözüm ya opsiyonel-context yolu ya
// da provider'ı `PaperProvider`ın ÜSTÜNE almaktır (App.tsx'te `KeyboardProvider`
// bilinçli olarak orada durur — AppModal'ın klavye hook'u bu yüzden çalışıyor).
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
  swipeToDismiss = true,
}: AppModalProps) {
  // `rendered`: çıkış animasyonu bitene kadar Portal mount'ta kalır (yoksa içerik
  // anında kaybolur, kapanış animasyonu hiç oynamaz).
  const [rendered, setRendered] = useState(visible);
  const progress = useSharedValue(0);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Klavye yüksekliği (react-native-keyboard-controller — klavyeyle YUMUŞAKÇA akan
  // reanimated shared value). DİKKAT: hook'un height'ı 0 → -klavyeYüksekliği akar
  // (NEGATİF; lib translateY'de doğrudan kullanılsın diye) — contentAnimStyle'da
  // pozitife çevrilir. İçinde TextInput olan modallar (ör. ServerAddressSheet,
  // kartela ölçü sheet'i, arama alanlı picker'lar) klavye açılınca yukarı kayar,
  // kapanınca iner. Klavye kapalıyken height=0 → hiçbir modal davranışı değişmez.
  const keyboard = useReanimatedKeyboardAnimation();

  // Sürükle-kapat için canlı offset'ler (px). dragY: bottom/center, dragX: right.
  const dragY = useSharedValue(0);
  const dragX = useSharedValue(0);
  // Ölçülen içerik yüksekliği (onLayout). Klavye telafisi bununla SINIRLANIR:
  // uzun modalı (ör. winH*0.85 picker) yatayda klavye kadar yukarı itince üstteki
  // input ekranın dışına taşıyordu; clamp modalın üst kenarını güvenli alanda tutar.
  const contentH = useSharedValue(0);
  // Gesture-içi durum (worklet'ler arası): çekiş üst bölgeden mi başladı, başlangıç
  // mutlak konumu, ve "kapanıyor" bayrağı (onFinalize geri-yaylanmayı atlasın).
  const zoneOk = useSharedValue(false);
  const startAbsX = useSharedValue(0);
  const startAbsY = useSharedValue(0);
  const closing = useSharedValue(false);

  const finishHide = useCallback(() => {
    setRendered(false);
    // Bir sonraki açılış temiz başlasın: sürükleme offset'lerini sıfırla.
    dragY.value = 0;
    dragX.value = 0;
    closing.value = false;
    onHidden?.();
    // shared value'lar kararlı; sadece onHidden bağımlılık.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Backdrop, hem açılış progress'i hem sürükleme mesafesiyle solar — kullanıcı
  // içeriği uzaklaştırdıkça arka perde de açılır (yön/mesafeye göre).
  const backdropStyle = useAnimatedStyle(() => {
    const dragFade =
      position === 'right'
        ? Math.min(1, Math.max(0, dragX.value) / (width * 0.6))
        : Math.min(1, Math.max(0, dragY.value) / (height * 0.4));
    return { opacity: progress.value * 0.5 * (1 - dragFade) };
  });

  const contentAnimStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const kb = -keyboard.height.value; // klavye yüksekliği, POZİTİF (0 = kapalı; hook negatif akar)
    const H = contentH.value; // ölçülen modal yüksekliği (0 = henüz ölçülmedi → tam telafi)
    if (position === 'right') {
      // Sağ drawer tam yükseklik — içindeki alanlar kendi kaydırmasıyla yönetilir.
      return { opacity: 1, transform: [{ translateX: (1 - p) * width + dragX.value }] };
    }
    if (position === 'bottom') {
      // Alttan sheet: klavye kadar yukarı kayar (klavyenin üstünde durur) — AMA
      // üst kenarı güvenli alanı geçmesin. Uzun sheet'te klavye kadar itmek üstteki
      // içeriği (başlık/input) ekran dışına taşırdı; naturalTop=height−H'den insets'e
      // kalan mesafeyle sınırla.
      const maxLift = Math.max(0, height - H - insets.top);
      const lift = Math.min(kb, maxLift);
      return {
        opacity: 1,
        transform: [{ translateY: (1 - p) * height + dragY.value - lift }],
      };
    }
    // center: diyaloğu görünür alanda tutmak için yarı klavye yüksekliği kadar yukarı
    // taşı — AMA üst kenarı güvenli alanın üstüne çıkmasın (uzun/tam-ekran modalda
    // üstteki input kırpılıyordu). naturalTop=(height−H)/2'den insets'e kalanla clamp'le.
    const naturalTop = (height - H) / 2;
    const maxLift = Math.max(0, naturalTop - insets.top);
    const lift = Math.min(kb / 2, maxLift);
    return {
      opacity: p,
      transform: [{ translateY: dragY.value - lift }, { scale: 0.97 + p * 0.03 }],
    };
  });

  // Sürükle-kapat gesture'ı. dismissable + swipeToDismiss + görünür iken aktif.
  const canSwipe = dismissable && swipeToDismiss && visible;
  const gesture = useMemo(() => {
    if (position === 'right') {
      // Sağ drawer: sağa kaydır = kapat. Yatay eksen → dikey scroll'la çakışmaz
      // (failOffsetY: dikey önce gelirse gesture düşer, ScrollView devralır).
      return Gesture.Pan()
        .enabled(canSwipe)
        .activeOffsetX(18)
        .failOffsetY([-14, 14])
        .onUpdate((e) => {
          'worklet';
          dragX.value = e.translationX > 0 ? e.translationX : e.translationX * 0.25;
        })
        .onEnd((e) => {
          'worklet';
          if (e.translationX > H_DISMISS_DIST || e.velocityX > H_DISMISS_VEL) {
            closing.value = true;
            runOnJS(onDismiss)();
          } else {
            dragX.value = withTiming(0, { duration: SPRING_BACK_MS });
          }
        })
        .onFinalize(() => {
          'worklet';
          if (!closing.value) dragX.value = withTiming(0, { duration: SPRING_BACK_MS });
        });
    }
    // bottom & center: aşağı çek = kapat. manualActivation ile yalnız ÜST bölgeden
    // (DRAG_ZONE) başlayan aşağı çekişte devreye girer; gövdeye/scroll'a dokunulan
    // çekişlerde fail() → içteki ScrollView/FlashList serbestçe kaydırır. Dokunma
    // (hareketsiz) hiç aktive olmaz → X tuşu/ butonlar normal çalışır.
    return Gesture.Pan()
      .enabled(canSwipe)
      .manualActivation(true)
      .onBegin((e) => {
        'worklet';
        zoneOk.value = e.y <= DRAG_ZONE;
        startAbsX.value = e.absoluteX;
        startAbsY.value = e.absoluteY;
        closing.value = false;
      })
      .onTouchesMove((e, mgr) => {
        'worklet';
        const t = e.allTouches[0];
        if (!t) return;
        if (!zoneOk.value) {
          mgr.fail();
          return;
        }
        const dy = t.absoluteY - startAbsY.value;
        const dx = t.absoluteX - startAbsX.value;
        if (Math.abs(dx) > Math.abs(dy) + 4) {
          mgr.fail(); // belirgin yatay hareket → kapatma değil
          return;
        }
        if (dy > 6) mgr.activate();
        else if (dy < -6) mgr.fail(); // yukarı → bırak
      })
      .onUpdate((e) => {
        'worklet';
        dragY.value = e.translationY > 0 ? e.translationY : e.translationY * 0.25;
      })
      .onEnd((e) => {
        'worklet';
        if (e.translationY > V_DISMISS_DIST || e.velocityY > V_DISMISS_VEL) {
          closing.value = true;
          runOnJS(onDismiss)();
        } else {
          dragY.value = withTiming(0, { duration: SPRING_BACK_MS });
        }
      })
      .onFinalize(() => {
        'worklet';
        if (!closing.value) dragY.value = withTiming(0, { duration: SPRING_BACK_MS });
      });
    // dims + onDismiss + canSwipe + position değişince yeniden kur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, canSwipe, onDismiss, width, height]);

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
        <GestureDetector gesture={gesture}>
          <Animated.View
            onLayout={(e) => {
              contentH.value = e.nativeEvent.layout.height;
            }}
            style={[contentBase, contentAnimStyle, contentStyle]}
          >
            {children}
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </Portal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
});
