import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import AppModal from './AppModal';
import { colors, radius, spacing } from '../theme';

const SPRING = { damping: 22, stiffness: 240, mass: 0.6 };
/** Yarım moddan bu oranın altına çekilirse modal kapanır. */
const DISMISS_RATIO = 0.55;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  /** Tutamacın altına, sürükleme alanının DIŞINA yerleşir (butonları tıklanır kalsın). */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Yarım mod yüksekliği — ekran yüksekliğinin oranı (default 0.55). */
  halfRatio?: number;
  /** Tam mod yüksekliği — ekran yüksekliğinin oranı (default 0.92). */
  fullRatio?: number;
  /** Mod değişince bildirir (başlık metni/ikonu uyarlamak isteyen ekranlar için). */
  onModeChange?: (mode: 'half' | 'full') => void;
}

/**
 * İki modlu (yarım / tam) sürüklenebilir alt sayfa.
 *
 * Tutamaçtan yukarı çek → tam ekran, aşağı çek → yarım, yarımdan aşağı çek →
 * kapanır. Hıza duyarlı yaslama (fırlatınca niyet edilen moda gider).
 *
 * `AppModal`'ın kendi sürükle-kapat davranışı KAPATILIR (`swipeToDismiss={false}`):
 * o, içeriğin üst 80px'inden aşağı çekişi kapanma sayar ve buradaki "yukarı çekip
 * büyüt" hareketiyle aynı bölgede çakışırdı. Tek jest her iki işi de yapar.
 */
export default function ResizableSheetModal({
  visible,
  onDismiss,
  header,
  children,
  halfRatio = 0.55,
  fullRatio = 0.92,
  onModeChange,
}: Props) {
  const { height: winH } = useWindowDimensions();
  const HALF = Math.round(winH * halfRatio);
  const FULL = Math.round(winH * fullRatio);

  const h = useSharedValue(HALF);
  const startH = useSharedValue(0);
  const [mode, setMode] = useState<'half' | 'full'>('half');

  const applyMode = useCallback(
    (m: 'half' | 'full') => {
      setMode(m);
      onModeChange?.(m);
    },
    [onModeChange],
  );

  // Her açılışta yarım moda dön — kapanırken bırakılan yükseklik bir sonraki
  // açılışa sızmasın (operatör "neden tam ekran açıldı" demesin).
  useEffect(() => {
    if (!visible) return;
    h.value = HALF;
    applyMode('half');
  }, [visible, HALF, h, applyMode]);


  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          startH.value = h.value;
        })
        .onUpdate((e) => {
          // Aşağı çekişte HALF'in altına inebilsin (kapatma niyeti ölçülebilsin);
          // yukarıda FULL tavanı.
          h.value = Math.min(FULL, startH.value - e.translationY);
        })
        .onEnd((e) => {
          const projected = h.value - e.velocityY * 0.12;
          if (projected < HALF * DISMISS_RATIO) {
            runOnJS(onDismiss)();
            return;
          }
          const target =
            Math.abs(projected - FULL) < Math.abs(projected - HALF) ? FULL : HALF;
          h.value = withSpring(target, SPRING);
          runOnJS(applyMode)(target === FULL ? 'full' : 'half');
        }),
    [h, startH, HALF, FULL, onDismiss, applyMode],
  );

  const sheetStyle = useAnimatedStyle(() => ({ height: h.value }));

  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      position="bottom"
      swipeToDismiss={false}
      contentStyle={styles.content}
    >
      <Animated.View style={[styles.sheet, sheetStyle]}>
        {/* Sürükleme alanı — yalnız tutamaç. Header dışarıda kalır ki içindeki
            "Tamam"/kapat butonları jeste yem olmasın. */}
        <GestureDetector gesture={pan}>
          <View style={styles.handleArea}>
            <View style={styles.grabber} />
          </View>
        </GestureDetector>
        {header}
        <View style={styles.body}>{children}</View>
      </Animated.View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  content: { width: '100%' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  // Tutamaç alanı geniş tutulur (parmakla yakalanabilsin) — görsel çizgi ince.
  handleArea: { paddingTop: 8, paddingBottom: 10, alignItems: 'center' },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  body: { flex: 1 },
});
