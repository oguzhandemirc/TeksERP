// Belge Tara — çekilen sayfanın TAM EKRAN önizlemesi (contain, koyu zemin, sayfa geçişi, iki parmak/çift dokunuş yakınlaştırma).
import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton, Text } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { colors, palette, spacing, typography } from '../../../theme';
import type { ScanPage } from './docScan';

interface Props {
  pages: readonly ScanPage[];
  /** Açık sayfanın sırası; null → kapalı. */
  index: number | null;
  uploaded: ReadonlySet<string>;
  onIndex: (index: number) => void;
  onRemove: (index: number) => void;
  onDismiss: () => void;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

// Yakınlaştırma yalnız kurulu gesture-handler + reanimated ile; sayfa değişince `key` ile sıfırlanır.
function ZoomableImage({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      'worklet';
      savedScale.value = scale.value;
      if (scale.value <= 1) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      }
    });
  // Kaydırma yalnız yakınken (1x'te görsel zaten ekrana sığar).
  const pan = Gesture.Pan()
    .minPointers(1)
    .onUpdate((e) => {
      'worklet';
      if (scale.value <= 1) return;
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      'worklet';
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      'worklet';
      const next = scale.value > 1 ? 1 : DOUBLE_TAP_SCALE;
      scale.value = withTiming(next);
      savedScale.value = next;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedTx.value = 0;
      savedTy.value = 0;
    });
  const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.imageBox} collapsable={false}>
        <Animated.Image source={{ uri }} style={[styles.image, style]} resizeMode="contain" testID="belge-tara-onizleme-gorsel" />
      </Animated.View>
    </GestureDetector>
  );
}

export default function PagePreviewModal({ pages, index, uploaded, onIndex, onRemove, onDismiss }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const page = index !== null ? pages[index] : undefined;
  const visible = page !== undefined;
  const i = index ?? 0;
  const total = pages.length;

  return (
    // Sağa kaydırıp kapatma kapalı: yakınken kaydırma (pan) ile çakışırdı; kapat düğmesi + geri tuşu var.
    <AppModal visible={visible} onDismiss={onDismiss} position="right" contentStyle={{ width, height }} swipeToDismiss={false}>
      <View style={[styles.page, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]} testID="belge-tara-onizleme">
        <View style={styles.header}>
          <Text style={styles.title} testID="belge-tara-onizleme-baslik">
            Sayfa {i + 1} / {total}
            {page && uploaded.has(page.sha256) ? ' ✓' : ''}
          </Text>
          <View style={styles.flex1} />
          {page && !uploaded.has(page.sha256) && (
            <Button
              mode="text"
              icon="delete-outline"
              textColor={colors.textOnDark}
              onPress={() => onRemove(i)}
              contentStyle={styles.headerBtn}
              accessibilityLabel={`Sayfa ${i + 1} sil`}
              testID="belge-tara-onizleme-sil"
            >
              Sil
            </Button>
          )}
          <IconButton
            icon="close"
            iconColor={colors.textOnDark}
            size={32}
            style={styles.iconBtn}
            onPress={onDismiss}
            accessibilityLabel="Önizlemeyi kapat"
            testID="belge-tara-onizleme-kapat"
          />
        </View>
        <View style={styles.body}>
          {total > 1 && (
            <IconButton
              icon="chevron-left"
              iconColor={colors.textOnDark}
              size={40}
              style={styles.iconBtn}
              disabled={i <= 0}
              onPress={() => onIndex(i - 1)}
              accessibilityLabel="Önceki sayfa"
              testID="belge-tara-onizleme-onceki"
            />
          )}
          {page && <ZoomableImage key={page.sha256} uri={page.uri} />}
          {total > 1 && (
            <IconButton
              icon="chevron-right"
              iconColor={colors.textOnDark}
              size={40}
              style={styles.iconBtn}
              disabled={i >= total - 1}
              onPress={() => onIndex(i + 1)}
              accessibilityLabel="Sonraki sayfa"
              testID="belge-tara-onizleme-sonraki"
            />
          )}
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.black, paddingHorizontal: spacing.sm, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.md },
  title: { color: colors.textOnDark, fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
  flex1: { flex: 1 },
  headerBtn: { minHeight: 56 },
  iconBtn: { width: 56, height: 56, margin: 0 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  imageBox: { flex: 1, alignSelf: 'stretch', overflow: 'hidden', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
