// =============================================================================
// Canlı okuma (L3) ekranı — kamera açıkken alanları okur, sağ panele doldurur
// =============================================================================
// Solda canlı kamera (~%65) + görülen kelimelere sarı kutular; belge türü bulunana dek tarama çizgisi; sol üstte kapat +
// durum hapı. Sağda alan paneli. Hepsi kilitlenince "Kıpırdatmayın" halkası → tek fotoğraf; "Çek ve bitir" her an elle bitirir.
// Dar ekranda (`useIsCompact`: el terminali, telefon dikey) kamera tam genişlik; yan panel yerine "Çek ve bitir"in üstünde özet
// şeridi, dokununca aynı `LiveFieldPanel` alt sayfada (kamera ve okuma döngüsü arkada sürer).
// Fotoğraf bugünkü yükleme yoluna gider (`onDone`); kilitli değerler forma `applyLiveLocks` ile girer. Durum `useLiveRead`.
// =============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Button, IconButton, ProgressBar, Text, TouchableRipple } from 'react-native-paper';
import { useCameraPermissions } from 'expo-camera';
import AppModal from '../../../../components/AppModal';
import TruncatedText from '../../../../components/TruncatedText';
import { StatusPill } from '../../../../components/form';
import LiveCameraView from '../../../../components/liveCamera/LiveCameraView';
import { isLiveTorchAvailable } from '../../../../services/liveCamera';
import { withSystemDialog } from '../../../../store/lockStore';
import { useIsCompact } from '../../../../hooks/useDeviceType';
import { colors, radius, spacing, typography } from '../../../../theme';
import { useDocTorch } from '../docTorch';
import TorchButton from '../TorchButton';
import type { MultiCameraBinding } from '../usePageSource';
import LiveFieldPanel from './LiveFieldPanel';
import LiveSummaryStrip from './LiveSummaryStrip';
import { wordRects } from './liveBoxes';
import { useLiveRead } from './useLiveRead';

export const LIVE_SEARCHING = 'Belge aranıyor…';
export const LIVE_FOUND = 'Belge tespit edildi:';
export const LIVE_FOUND_SHORT = 'Bulundu:';

export default function LiveReadModal({ visible, onDone, onDismiss }: MultiCameraBinding) {
  const { width, height } = useWindowDimensions();
  const [permission] = useCameraPermissions();
  const [view, setView] = useState({ width: 0, height: 0 });
  const live = useLiveRead({ visible, onDone });
  const torch = useDocTorch(visible);
  const torchAvailable = isLiveTorchAvailable();
  const name = live.vote.template?.name ?? null;
  const compact = useIsCompact();
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    if (!visible) setSheetOpen(false);
  }, [visible]);

  const dismiss = () => {
    if (!live.capturing) onDismiss();
  };
  const onLayout = (e: LayoutChangeEvent) => setView({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  return (
    <AppModal visible={visible} onDismiss={dismiss} swipeToDismiss={false} contentStyle={[styles.sheet, { width: width * 0.98, height: height * 0.96 }]}>
      <View style={[styles.layout, compact && styles.layoutCompact]}>
        <View style={styles.cameraLayer} onLayout={onLayout} testID="canli-kamera">
          <CameraBody live={live} view={view} searching={!name} torch={torchAvailable && torch.torch} />
          <View style={styles.topBar}>
            <IconButton icon="close" size={32} iconColor={colors.textOnDark} style={styles.close} onPress={dismiss} disabled={live.capturing} accessibilityLabel="Kapat" testID="canli-kapat" />
            <StatusPill tone={name ? 'ok' : 'busy'} icon={name ? 'file-document-check-outline' : 'magnify'} text={name ? (compact ? LIVE_FOUND_SHORT : LIVE_FOUND) : LIVE_SEARCHING} testID="canli-durum" />
            {name && (
              <TruncatedText style={styles.docName} testID="canli-belge-adi">
                {name}
              </TruncatedText>
            )}
            {torchAvailable && <TorchButton on={torch.torch} onPress={torch.toggle} style={styles.torch} testID="canli-flas" />}
          </View>
          {live.cameraError && (
            <Text style={[styles.onDark, styles.error]} testID="canli-kamera-hata">{live.cameraError}</Text>
          )}
          {live.holdProgress !== null && !live.capturing && <HoldRing progress={live.holdProgress} />}
          {live.capturing && (
            <View style={styles.overlay} testID="canli-cekiliyor">
              <ActivityIndicator color={colors.textOnDark} size="large" />
              <Text style={styles.onDark}>Fotoğraf hazırlanıyor…</Text>
            </View>
          )}
          <View style={styles.shootBar}>
            {compact && <LiveSummaryStrip vote={live.vote} width={width * 0.98 - spacing.lg * 2} onPress={() => setSheetOpen(true)} />}
            <Button
              mode="contained"
              icon="camera"
              onPress={live.capture}
              loading={live.capturing}
              disabled={live.capturing || !permission?.granted}
              contentStyle={styles.shootBtn}
              labelStyle={styles.shootLabel}
              testID="canli-simdi-cek"
            >
              Çek ve bitir
            </Button>
          </View>
        </View>
        {!compact && (
          <View style={styles.side}>
            <LiveFieldPanel vote={live.vote} onEdit={live.edit} onUnlock={live.unlock} />
          </View>
        )}
        {compact && sheetOpen && (
          <View style={StyleSheet.absoluteFill} testID="canli-alan-sayfasi">
            <TouchableRipple style={styles.sheetScrim} rippleColor="transparent" onPress={() => setSheetOpen(false)} accessibilityLabel="Alanları kapat" testID="canli-sayfa-arka">
              <View />
            </TouchableRipple>
            <View style={styles.fieldSheet}>
              <IconButton icon="chevron-down" size={28} style={styles.sheetClose} onPress={() => setSheetOpen(false)} accessibilityLabel="Alanları kapat" testID="canli-sayfa-kapat" />
              <LiveFieldPanel vote={live.vote} onEdit={live.edit} onUnlock={live.unlock} />
            </View>
          </View>
        )}
      </View>
    </AppModal>
  );
}

/** Kamera katmanı: izin → canlı önizleme + kelime kutuları + (belge türü yokken) tarama çizgisi. */
function CameraBody({ live, view, searching, torch }: { live: ReturnType<typeof useLiveRead>; view: { width: number; height: number }; searching: boolean; torch: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();
  if (!permission) return <ActivityIndicator color={colors.textOnDark} />;
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.onDark}>Canlı okuma için kamera izni gerekiyor.</Text>
        <Button mode="contained" contentStyle={styles.btn} onPress={() => void withSystemDialog(() => requestPermission())} testID="canli-izin">
          Kamera izni ver
        </Button>
      </View>
    );
  }
  return (
    <>
      <LiveCameraView ref={live.cameraRef} style={StyleSheet.absoluteFill} torch={torch} onText={live.onText} onStability={live.onStability} onError={live.onCameraError} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="canli-kutular">
        {wordRects(live.ocr, view).map((r, i) => (
          <View key={i} style={[styles.box, r]} />
        ))}
      </View>
      {searching && <ScanLine height={view.height} />}
    </>
  );
}

/** Belge türü bulunana dek önizlemede inip çıkan çizgi ("arıyorum" işareti). */
function ScanLine({ height }: { height: number }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(y, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(y, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [y]);
  const translateY = y.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, height - 4)] });
  return <Animated.View pointerEvents="none" style={[styles.scanLine, { transform: [{ translateY }] }]} testID="canli-tarama-cizgisi" />;
}

/** Otomatik çekim öncesi uyarı: koşul halka dolana dek sürerse fotoğraf çekilir. */
function HoldRing({ progress }: { progress: number }) {
  return (
    <View pointerEvents="none" style={styles.ringWrap} testID="canli-halka">
      <View style={styles.ring}>
        <Text style={styles.ringText}>Kıpırdatmayın</Text>
        <ProgressBar progress={progress} color={colors.success} style={styles.ringBar} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.headerBg, borderRadius: radius.lg, overflow: 'hidden', padding: 0 },
  layout: { flex: 1, flexDirection: 'row' },
  cameraLayer: { flex: 65, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  side: { flex: 35 },
  layoutCompact: { flexDirection: 'column' },
  // Alt sayfa: üst yarı kamerayı göstermeye devam eder (dokununca kapanır), alt yarı tam genişlik alan paneli.
  sheetScrim: { flex: 1, backgroundColor: colors.scrim },
  fieldSheet: { height: '50%', backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, overflow: 'hidden' },
  sheetClose: { alignSelf: 'center', width: 56, height: 40, margin: 0 },
  center: { gap: spacing.md, alignItems: 'center', padding: spacing.lg },
  box: { position: 'absolute', borderWidth: 1, borderColor: colors.warning, borderRadius: 2 },
  scanLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: colors.warning, opacity: 0.8 },
  topBar: { position: 'absolute', top: spacing.sm, left: spacing.sm, right: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  torch: { marginLeft: 'auto' },
  close: { width: 56, height: 56, margin: 0, borderRadius: radius.full, backgroundColor: colors.scrim },
  error: { position: 'absolute', top: 80, left: spacing.lg, right: spacing.lg, textAlign: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  ringWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  ring: {
    width: 220, height: 220, borderRadius: 110, borderWidth: 6, borderColor: colors.success, backgroundColor: colors.scrim,
    justifyContent: 'center', alignItems: 'center', gap: spacing.md, padding: spacing.lg,
  },
  ringText: { color: colors.textOnDark, fontSize: 22, fontWeight: '800' },
  ringBar: { width: 140, height: 8, borderRadius: 4 },
  shootBar: { position: 'absolute', bottom: spacing.lg, left: 0, right: 0, alignItems: 'center', gap: spacing.sm },
  shootBtn: { minHeight: 72, paddingHorizontal: spacing.xxl },
  shootLabel: { fontSize: 20, fontWeight: '800' },
  btn: { minHeight: 56 },
  docName: { flexShrink: 1, color: colors.textOnDark, fontSize: 18, fontWeight: '700' },
  onDark: { color: colors.textOnDark, fontSize: typography.size.base },
});
