import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
import Toast from 'react-native-toast-message';
import { BarcodeScannerView, type SupportedBarcodeType } from './BarcodeScannerView';
import { toastConfig } from './ToastConfig';
import { useFullscreenModalProps } from '../hooks/useFullscreenModalProps';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onScan: (barcode: string) => void;
  /** Üst başlık — neyi taradığımızı operatöre söyler. */
  title?: string;
  /** Hangi barkod tiplerini okusun. Default: QR + Code128. */
  barcodeTypes?: SupportedBarcodeType[];
  /** Modal kapanma animasyonu tamamen bittikten sonra çağrılır. Parent state'i
   *  bu callback'te güncellesin — animation sırasında recutMode vb. mount
   *  edilirse invisible modal overlay tıklamayı yutar. */
  onModalHide?: () => void;
  /** Sürekli okuma — modal açık kalıp arka arkaya çok top okutan akışlar için. */
  continuous?: boolean;
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
  onModalHide,
  continuous,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const modalProps = useFullscreenModalProps();
  return (
    <RNModal
      isVisible={visible}
      onBackdropPress={onDismiss}
      onBackButtonPress={onDismiss}
      onModalHide={onModalHide}
      backdropOpacity={0.7}
      style={styles.modal}
      useNativeDriver
      hideModalContentWhileAnimating
      {...modalProps}
    >
      <View style={[styles.sheet, { width: winW * 0.7, height: winH * 0.8 }]}>
        <BarcodeScannerView
          active={visible}
          onClose={onDismiss}
          onScan={onScan}
          title={title}
          barcodeTypes={barcodeTypes}
          continuous={continuous}
        />
      </View>
      {/* Modal native katmanda açıldığından kök <Toast/> ARKADA kalıyor; hata/başarı
          mesajları okunmuyordu. Modalın İÇİNE ikinci bir Toast koyuyoruz — kütüphane
          en son mount olan ref'i kullanır (modal kapanınca otomatik köke döner), böylece
          tarama mesajları kameranın ÜSTÜNDE görünür. */}
      <Toast config={toastConfig} />
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
