import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text, ActivityIndicator } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';

export type SupportedBarcodeType =
  | 'qr'
  | 'code128'
  | 'ean13'
  | 'ean8'
  | 'code39'
  | 'code93'
  | 'codabar'
  | 'datamatrix'
  | 'pdf417'
  | 'aztec'
  | 'itf14'
  | 'upc_e'
  | 'upc_a';

interface Props {
  /** Mount/unmount tetiği — false ise CameraView kapanır (pil/CPU). */
  active: boolean;
  onScan: (barcode: string) => void;
  /** Close butonu — çağıran bileşene "scanner'ı kapat" sinyali. Yoksa header
   *  butonu render edilmez (kullanan akış kendi kapanışını yönetir). */
  onClose?: () => void;
  title?: string;
  barcodeTypes?: SupportedBarcodeType[];
}

/**
 * BarcodeScannerModal'ın RNModal sarmasız varyantı — başka modal'ların İÇİNDE
 * kullanılabilir. Nested RNModal sorunu (RN'de iki RNModal aynı anda render
 * edilmez) bu component'le aşılır.
 *
 * Kullanım örnekleri:
 *  - Top-level modal (kendi başına): BarcodeScannerModal bunu RNModal içine sarar
 *  - Diğer modal'ın içinde overlay olarak: ResplitModal vb. doğrudan bu view'i
 *    conditional render eder
 */
export function BarcodeScannerView({
  active,
  onScan,
  onClose,
  title = 'Barkod / QR Okut',
  barcodeTypes = ['qr', 'code128'],
}: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (active) {
      scannedRef.current = false;
      setBusy(false);
    }
  }, [active]);

  const handleScanned = useCallback(({ data }: { data: string }) => {
    if (!data || scannedRef.current) return;
    scannedRef.current = true;
    setBusy(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => onScanRef.current(data), 80);
  }, []);

  const body = !permission ? (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  ) : !permission.granted ? (
    <View style={styles.center}>
      <Text variant="titleMedium" style={styles.permTitle}>
        Kamera izni gerekli
      </Text>
      <Text style={styles.permBody}>
        QR / barkod okumak için kamera erişimini onaylayın.
      </Text>
      <Button mode="contained" onPress={requestPermission} style={{ marginTop: 16 }}>
        İzin Ver
      </Button>
    </View>
  ) : active ? (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes }}
        onBarcodeScanned={busy ? undefined : handleScanned}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.targetFrame} />
        <Text style={styles.overlayHint}>
          QR'ı çerçeve içine alın · otomatik okunur
        </Text>
      </View>
      {busy && (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
    </View>
  ) : (
    <View style={styles.center} />
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="titleMedium" style={styles.title}>
          {title}
        </Text>
        <View style={{ flex: 1 }} />
        {onClose && (
          <IconButton
            icon="close"
            size={22}
            iconColor="#fff"
            onPress={onClose}
            style={{ margin: 0 }}
          />
        )}
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#1e293b',
  },
  title: { color: '#fff', fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 6 },
  permTitle: { color: '#fff', fontWeight: '700' },
  permBody: { color: '#cbd5e1', textAlign: 'center' },
  cameraWrap: { flex: 1, backgroundColor: '#000', position: 'relative' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  targetFrame: {
    width: 260,
    height: 260,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  overlayHint: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
