// =============================================================================
// Kusurlu levent reddi — kusur fotoğrafı kamerası (expo-camera `takePictureAsync`, yeni paket yok)
// =============================================================================
// Emsal `GelenBelge/PageCameraModal`. Belge değil kanıt fotoğrafı: kamera varsayılan boyu + JPEG kalite 0,5
// (5 MB sunucu tavanının çok altında, ağda hızlı). `initialFacing` zorlanmaz (mobil/CLAUDE.md § Kamera).
// =============================================================================
import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AppModal from '../../../components/AppModal';
import { withSystemDialog } from '../../../store/lockStore';
import { colors, spacing, typography } from '../../../theme';

const REJECT_PHOTO_QUALITY = 0.5;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onCaptured: (photo: { uri: string; base64: string }) => void;
  onError: (message: string) => void;
}

export default function RejectCameraModal({ visible, onDismiss, onCaptured, onError }: Props) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [busy, setBusy] = useState(false);

  const capture = async () => {
    if (busy || !cameraRef.current) return;
    setBusy(true);
    try {
      const pic = await cameraRef.current.takePictureAsync({ quality: REJECT_PHOTO_QUALITY, base64: true, exif: false });
      if (!pic?.base64) throw new Error('Fotoğraf alınamadı');
      onCaptured({ uri: pic.uri, base64: pic.base64 });
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
      <Text style={styles.onDark}>Kusur fotoğrafı için kamera izni gerekiyor.</Text>
      <Button mode="contained" onPress={() => void withSystemDialog(() => requestPermission())}>Kamera izni ver</Button>
    </View>
  ) : (
    <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} />
  );

  return (
    <AppModal visible={visible} onDismiss={onDismiss} contentStyle={[styles.sheet, { width: width * 0.94, height: height * 0.9 }]}>
      <View style={styles.cameraLayer}>{body}</View>
      <View style={styles.bar}>
        <Text style={styles.onDark}>Kusurlu yeri çerçeveye alın</Text>
        <View style={styles.actions}>
          <Button mode="outlined" textColor={colors.textOnDark} onPress={onDismiss} contentStyle={styles.btn} disabled={busy}>Kapat</Button>
          <Button mode="contained" icon="camera" onPress={() => void capture()} contentStyle={styles.btn} loading={busy} disabled={busy || !permission?.granted} testID="devere-ret-foto-cek">Çek</Button>
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
