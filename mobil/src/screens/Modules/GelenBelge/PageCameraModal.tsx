// =============================================================================
// Belge Tara — sayfa çekim kamerası (expo-camera `takePictureAsync`, yeni paket yok)
// =============================================================================
// Boy: kameranın sunduğu 4:3 boylardan uzun kenarı ≈2600 px (`pickPictureSize`), JPEG kalite 0,8, base64.
// Özet (sha256) çekimden hemen sonra hesaplanır; ekran aynı fotoğrafı ikinci kez listeye almaz.
// `initialFacing` zorlanmaz (mobil/CLAUDE.md § Kamera) — arka kamera expo varsayılanıdır.
// =============================================================================
import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AppModal from '../../../components/AppModal';
import { withSystemDialog } from '../../../store/lockStore';
import { colors, spacing, typography } from '../../../theme';
import { CAPTURE_QUALITY, photoSha256, pickPictureSize, type ScanPage } from './docScan';

interface Props {
  visible: boolean;
  pageNo: number;
  onDismiss: () => void;
  onCaptured: (page: ScanPage) => void;
  onError: (message: string) => void;
}

export default function PageCameraModal({ visible, pageNo, onDismiss, onCaptured, onError }: Props) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const onReady = async () => {
    try {
      const sizes = (await cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
      setPictureSize(pickPictureSize(sizes));
    } catch {
      setPictureSize(undefined); // kamera varsayılanı; çekim yine çalışır
    }
  };

  const capture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: CAPTURE_QUALITY, base64: true, exif: false });
      if (!pic?.base64) throw new Error('Fotoğraf alınamadı');
      const base64 = pic.base64;
      // Özet ağır (≈1–2 MB); döndürücü çizilsin diye bir kare bekle.
      await new Promise((r) => setTimeout(r, 0));
      onCaptured({ base64, sha256: photoSha256(base64), uri: pic.uri, width: pic.width, height: pic.height });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Fotoğraf çekilemedi');
    } finally {
      setBusy(false);
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

  return (
    <AppModal visible={visible} onDismiss={onDismiss} contentStyle={[styles.sheet, { width: width * 0.94, height: height * 0.9 }]}>
      <View style={styles.cameraLayer}>{body}</View>
      <View style={styles.bar}>
        <Text style={styles.onDark}>Sayfa {pageNo} — belgeyi çerçeveye düz yerleştirin</Text>
        <View style={styles.actions}>
          <Button mode="outlined" textColor={colors.textOnDark} onPress={onDismiss} contentStyle={styles.btn} disabled={busy}>
            Kapat
          </Button>
          <Button
            mode="contained"
            icon="camera"
            onPress={() => void capture()}
            contentStyle={styles.btn}
            loading={busy}
            disabled={busy || !permission?.granted}
            testID="belge-tara-cek"
          >
            Çek
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: colors.headerBg, borderRadius: 16, overflow: 'hidden', padding: 0 },
  cameraLayer: { flex: 1, position: 'relative', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  center: { gap: spacing.md, alignItems: 'center', padding: spacing.lg },
  bar: { padding: spacing.md, gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  btn: { minHeight: 56, paddingHorizontal: spacing.md },
  onDark: { color: colors.textOnDark, fontSize: typography.size.base },
});
