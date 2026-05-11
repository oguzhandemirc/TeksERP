import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
import { Button, IconButton, Text, ActivityIndicator } from 'react-native-paper';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onScan: (barcode: string) => void;
  /** Üst başlık — neyi taradığımızı operatöre söyler. */
  title?: string;
  /** Hangi barkod tiplerini okusun. Default: QR + Code128. */
  barcodeTypes?: ('qr' | 'code128' | 'ean13' | 'ean8' | 'code39' | 'code93' | 'codabar' | 'datamatrix' | 'pdf417' | 'aztec' | 'itf14' | 'upc_e' | 'upc_a')[];
}

/**
 * Tablet kamerasıyla QR/barcode okuma — reusable modal.
 *
 * Kullanım:
 *   <BarcodeScannerModal
 *     visible={open}
 *     onDismiss={() => setOpen(false)}
 *     onScan={(data) => { setBarcode(data); setOpen(false); }}
 *   />
 */
export function BarcodeScannerModal({
  visible,
  onDismiss,
  onScan,
  title = 'Barkod / QR Okut',
  barcodeTypes = ['qr', 'code128'],
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const scannedRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // Modal her açıldığında re-arm: yeni tarama yapılabilsin.
  useEffect(() => {
    if (visible) {
      scannedRef.current = false;
      setBusy(false);
    }
  }, [visible]);

  const handleScanned = ({ data }: { data: string }) => {
    if (!data || scannedRef.current) return;
    scannedRef.current = true;
    setBusy(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Kısa gecikme ile callback — UI feedback (busy state) görünsün.
    setTimeout(() => onScan(data), 80);
  };

  const renderBody = () => {
    if (!permission) {
      return (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      );
    }
    if (!permission.granted) {
      return (
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
      );
    }
    return (
      <View style={styles.cameraWrap}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes }}
          onBarcodeScanned={busy ? undefined : handleScanned}
        />
        {/* Üst hedef çerçevesi */}
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
    );
  };

  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      backdropOpacity={0.7}
      style={styles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      deviceWidth={winW}
      deviceHeight={winH}
      statusBarTranslucent
    >
      <View style={[styles.sheet, { width: winW * 0.7, height: winH * 0.8 }]}>
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            {title}
          </Text>
          <View style={{ flex: 1 }} />
          <IconButton icon="close" size={22} onPress={onDismiss} style={{ margin: 0 }} />
        </View>
        {renderBody()}
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  modal: { justifyContent: 'center', alignItems: 'center', margin: 0 },
  sheet: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: '#1e293b',
  },
  title: { color: '#fff', fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 6, backgroundColor: '#0f172a' },
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
