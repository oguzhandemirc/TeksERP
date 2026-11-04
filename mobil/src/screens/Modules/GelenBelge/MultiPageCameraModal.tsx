// =============================================================================
// Belge okut — çok çekimli kamera (expo-camera, yeni paket yok)
// =============================================================================
// Art arda çek → küçük resim şeridi (sil) → "Tamam" → sayfalar native iyileştirmeyle (gölge/ışık düzleştirme) doğrudan
// ekrana; ara inceleme ekranı YOK. Kırpma/perspektif yok: ipucu belgeyi çerçeveyi dolduracak şekilde düz tutturur.
// Yer bitince kendiliğinden biter. Durum `useMultiCapture`, saf mantık `captureSession`.
// =============================================================================
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Toast from 'react-native-toast-message';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AppModal from '../../../components/AppModal';
import { withSystemDialog } from '../../../store/lockStore';
import { colors, spacing, typography } from '../../../theme';
import { pickPictureSize } from './docScan';
import type { FinishResult, Shot } from './captureSession';
import { useMultiCapture } from './useMultiCapture';
import type { MultiCameraBinding } from './usePageSource';

export const MULTI_CAMERA_HINT = 'Belgeyi çerçeveyi dolduracak şekilde düz tutun';

interface Props extends MultiCameraBinding {
  onError: (message: string) => void;
}

export default function MultiPageCameraModal({ visible, capacity, firstPageNo, onDone, onDismiss, onError }: Props) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const finished = (r: FinishResult) => {
    if (r.dropped) Toast.show({ type: 'error', text1: `${r.dropped} çekim okunamadı, eklenmedi` });
    onDone(r.pages);
  };
  const cap = useMultiCapture({ visible, capacity, cameraRef, onDone: finished, onError });
  const n = cap.shots.length;
  const busy = cap.progress !== null;

  const dismiss = () => {
    if (busy) return;
    if (cap.requestDismiss()) onDismiss();
  };

  const onReady = async () => {
    try {
      const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
      setPictureSize(pickPictureSize(sizes));
    } catch {
      setPictureSize(undefined); // kamera varsayılanı; çekim yine çalışır
    }
  };

  const body = !permission ? (
    <ActivityIndicator color={colors.textOnDark} />
  ) : !permission.granted ? (
    <View style={styles.center}>
      <Text style={styles.onDark}>Belge çekmek için kamera izni gerekiyor.</Text>
      <Button mode="contained" onPress={() => void withSystemDialog(() => requestPermission())}>
        Kamera izni ver
      </Button>
    </View>
  ) : (
    <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} pictureSize={pictureSize} onCameraReady={() => void onReady()} />
  );

  const counter = n ? `${n} sayfa çekildi (en çok ${capacity})` : `Sayfa ${firstPageNo} — ${MULTI_CAMERA_HINT}`;

  return (
    <AppModal visible={visible} onDismiss={dismiss} swipeToDismiss={false} contentStyle={[styles.sheet, { width: width * 0.94, height: height * 0.9 }]}>
      <View style={styles.cameraLayer}>
        {body}
        {busy && cap.progress && (
          <View style={styles.overlay} testID="belge-cok-iyilestiriliyor">
            <ActivityIndicator color={colors.textOnDark} size="large" />
            <Text style={styles.onDark}>
              Sayfalar iyileştiriliyor… {Math.min(cap.progress.done + 1, cap.progress.total)}/{cap.progress.total}
            </Text>
          </View>
        )}
      </View>
      <ShotStrip shots={cap.shots} firstPageNo={firstPageNo} disabled={busy} onRemove={cap.remove} />
      <View style={styles.bar}>
        <Text style={styles.onDark} testID="belge-cok-sayac">
          {cap.confirmDiscard ? `${n} çekim silinecek — kapatmak için Vazgeç'e tekrar basın` : counter}
        </Text>
        <View style={styles.actions}>
          <Button mode="outlined" textColor={colors.textOnDark} onPress={dismiss} contentStyle={styles.btn} disabled={busy} testID="belge-cok-vazgec">
            Vazgeç
          </Button>
          <Button
            mode="contained-tonal"
            icon="camera"
            onPress={cap.capture}
            contentStyle={styles.btn}
            loading={cap.shooting}
            disabled={cap.shooting || busy || !permission?.granted || n >= capacity}
            testID="belge-cok-cek"
          >
            Çek
          </Button>
          <Button mode="contained" icon="check" onPress={cap.finish} contentStyle={styles.btn} disabled={n === 0 || busy || cap.shooting} testID="belge-cok-tamam">
            {`Tamam (${n})`}
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

/** Çekilenler şeridi: her küçük resimde ≥56dp sil alanı (yanlış çekim tek dokunuşla atılır). */
function ShotStrip({ shots, firstPageNo, disabled, onRemove }: { shots: readonly Shot[]; firstPageNo: number; disabled: boolean; onRemove: (id: string) => void }) {
  if (!shots.length) return null;
  return (
    <ScrollView horizontal contentContainerStyle={styles.strip} style={styles.stripBox}>
      {shots.map((s, i) => (
        <View key={s.id} style={styles.thumb}>
          <Image source={{ uri: s.uri }} style={styles.thumbImage} resizeMode="cover" />
          <Text style={styles.thumbNo}>{firstPageNo + i}</Text>
          <Pressable
            onPress={() => onRemove(s.id)}
            disabled={disabled}
            style={styles.thumbDel}
            accessibilityLabel={`Sayfa ${firstPageNo + i} sil`}
            testID={`belge-cok-sil-${i}`}
          >
            <Text style={styles.thumbDelText}>✕</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.headerBg, borderRadius: 16, overflow: 'hidden', padding: 0 },
  cameraLayer: { flex: 1, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.scrim, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  center: { gap: spacing.md, alignItems: 'center', padding: spacing.lg },
  stripBox: { flexGrow: 0 },
  strip: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  thumb: { width: 72, height: 96, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.textOnDark },
  thumbImage: { width: '100%', height: '100%' },
  thumbNo: { position: 'absolute', left: 4, bottom: 2, color: colors.textOnDark, fontWeight: '700', textShadowColor: colors.headerBg, textShadowRadius: 3 },
  thumbDel: { position: 'absolute', top: 0, right: 0, width: 56, height: 56, alignItems: 'flex-end', justifyContent: 'flex-start', padding: 4 },
  thumbDelText: { color: colors.textOnDark, backgroundColor: colors.scrim, borderRadius: 12, width: 24, height: 24, textAlign: 'center', lineHeight: 24, fontWeight: '700' },
  bar: { padding: spacing.md, gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  btn: { minHeight: 56, paddingHorizontal: spacing.md },
  onDark: { color: colors.textOnDark, fontSize: typography.size.base },
});
