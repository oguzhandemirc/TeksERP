// Belge Tara — çekilen sayfanın TAM EKRAN önizlemesi (contain, koyu zemin, sayfa geçişi, iki parmak/çift dokunuş yakınlaştırma).
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, IconButton, Text } from 'react-native-paper';
import AppModal from '../../../components/AppModal';
import { colors, palette, spacing, typography } from '../../../theme';
import type { ScanPage } from './docScan';
import { focusGeometry, type Rect, type Size } from './woCreate/partyReview';

/** Fotoğrafta vurgulanacak kutu (okuma çerçevesinde); `frame` yoksa görüntünün kendi boyutu. `key` değişince yeniden odaklanır. */
export interface PreviewFocus {
  key: string;
  rect: Rect;
  frame: Size | null;
}

interface Props {
  /** Yalnız görüntü alanları okunur (okutulmuş belgenin `done.sent` kopyası da verilebilir). */
  pages: readonly Pick<ScanPage, 'sha256' | 'uri'>[];
  /** Açık sayfanın sırası; null → kapalı. */
  index: number | null;
  uploaded: ReadonlySet<string>;
  onIndex: (index: number) => void;
  /** Verilmezse "Sil" çizilmez (salt önizleme). */
  onRemove?: (index: number) => void;
  onDismiss: () => void;
  testID?: string;
  /** Yan bölme (çok partili belgede parti sekmeleri); yan ekranda sağda, dikeyde altta. */
  side?: React.ReactNode;
  /** Açık sayfada vurgulanıp ortalanacak kutu. */
  focus?: PreviewFocus | null;
}

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

// Yakınlaştırma yalnız kurulu gesture-handler + reanimated ile; sayfa değişince `key` ile sıfırlanır.
function ZoomableImage({ uri, focus }: { uri: string; focus?: PreviewFocus | null }) {
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

  const { geo, setBox } = useFocusGeometry(uri, focus);
  // Odak değişince (parti sekmesi) kutu ortalanır; görevli sonra serbestçe yakınlaştırır/kaydırır.
  const geoKey = geo ? `${focus?.key}:${geo.scale}:${geo.tx}:${geo.ty}` : null;
  useEffect(() => {
    if (!geo) return;
    scale.value = withTiming(geo.scale);
    savedScale.value = geo.scale;
    tx.value = withTiming(geo.tx);
    ty.value = withTiming(geo.ty);
    savedTx.value = geo.tx;
    savedTy.value = geo.ty;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yalnız odak anahtarı değişince
  }, [geoKey]);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={styles.imageBox} collapsable={false} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Animated.View style={[styles.image, style]}>
          <Animated.Image source={{ uri }} style={styles.image} resizeMode="contain" testID="belge-tara-onizleme-gorsel" />
          {geo && <View pointerEvents="none" style={[styles.focus, { left: geo.box.x, top: geo.box.y, width: geo.box.width, height: geo.box.height }]} testID="belge-tara-onizleme-vurgu" />}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/** Kutunun ekrandaki yeri: kap boyutu (onLayout) + kutu çerçevesi (tarama künyesi ya da görüntünün boyutu). */
function useFocusGeometry(uri: string, focus: PreviewFocus | null | undefined) {
  const [natural, setNatural] = useState<Size | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const need = !!focus && !focus.frame;
  useEffect(() => {
    if (!need) return;
    let live = true;
    Image.getSize(uri, (w, h) => live && setNatural({ w, h }), () => live && setNatural(null));
    return () => {
      live = false;
    };
  }, [uri, need]);
  const frame = focus?.frame ?? natural;
  return { geo: focus && frame && box ? focusGeometry(focus.rect, frame, box) : null, setBox };
}

export default function PagePreviewModal({ pages, index, uploaded, onIndex, onRemove, onDismiss, testID = 'belge-tara-onizleme', side, focus }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const page = index !== null ? pages[index] : undefined;
  const visible = page !== undefined;
  const i = index ?? 0;
  const total = pages.length;
  const wide = width > height;

  return (
    // Sağa kaydırıp kapatma kapalı: yakınken kaydırma (pan) ile çakışırdı; kapat düğmesi + geri tuşu var.
    <AppModal visible={visible} onDismiss={onDismiss} position="right" contentStyle={{ width, height }} swipeToDismiss={false}>
      <View style={[styles.page, { paddingTop: insets.top + spacing.sm, paddingBottom: insets.bottom + spacing.sm }]} testID={testID}>
        <View style={styles.header}>
          <Text style={styles.title} testID="belge-tara-onizleme-baslik">
            Sayfa {i + 1} / {total}
            {page && uploaded.has(page.sha256) ? ' ✓' : ''}
          </Text>
          <View style={styles.flex1} />
          {page && onRemove && !uploaded.has(page.sha256) && (
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
        <View style={[styles.split, wide ? styles.splitRow : styles.splitCol]}>
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
            {page && <ZoomableImage key={page.sha256} uri={page.uri} focus={focus} />}
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
          {side ? <View style={[styles.side, wide ? styles.sideRow : styles.sideCol]} testID={`${testID}-yan`}>{side}</View> : null}
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
  split: { flex: 1, gap: spacing.sm },
  splitRow: { flexDirection: 'row' },
  splitCol: { flexDirection: 'column' },
  side: { backgroundColor: colors.surface, borderRadius: 8, overflow: 'hidden' },
  sideRow: { width: '40%' },
  sideCol: { maxHeight: '50%' },
  focus: { position: 'absolute', borderWidth: 3, borderColor: palette.amber[500], backgroundColor: 'rgba(245, 158, 11, 0.12)', borderRadius: 4 },
  imageBox: { flex: 1, alignSelf: 'stretch', overflow: 'hidden', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
