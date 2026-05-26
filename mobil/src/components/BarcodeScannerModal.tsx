import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
import { BarcodeScannerView, type SupportedBarcodeType } from './BarcodeScannerView';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onScan: (barcode: string) => void;
  /** Üst başlık — neyi taradığımızı operatöre söyler. */
  title?: string;
  /** Hangi barkod tiplerini okusun. Default: QR + Code128. */
  barcodeTypes?: SupportedBarcodeType[];
}

/**
 * Tablet kamerasıyla QR/barcode okuma — RNModal sarmalı varyant. Top-level
 * akışlarda (form ekranlarından buton tetikli) kullanılır.
 *
 * Başka bir RNModal'ın İÇİNDE açılması gerekiyorsa (örn. ResplitModal içinde),
 * doğrudan `BarcodeScannerView`'i absoluteFill overlay olarak kullan —
 * nested RNModal RN'de render edilmez.
 *
 * UI/permission/scan logic'i `BarcodeScannerView` ile ortak; iki kullanım
 * birebir aynı görünür.
 */
export function BarcodeScannerModal({
  visible,
  onDismiss,
  onScan,
  title,
  barcodeTypes,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
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
        <BarcodeScannerView
          active={visible}
          onClose={onDismiss}
          onScan={onScan}
          title={title}
          barcodeTypes={barcodeTypes}
        />
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
});
