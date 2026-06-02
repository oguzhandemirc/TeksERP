import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import RNModal from 'react-native-modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import { BarcodeScannerView, type SupportedBarcodeType } from './BarcodeScannerView';
import { toastConfig } from './ToastConfig';
import { useFullscreenModalProps } from '../hooks/useFullscreenModalProps';
import { useDeviceType } from '../hooks/useDeviceType';

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
  const insets = useSafeAreaInsets();
  const isTablet = useDeviceType() === 'tablet';
  const modalProps = useFullscreenModalProps();

  // Modal tam ekranda ortalanır (justifyContent: 'center'). Telefonda eski
  // davranış korunur. Tablette ekran yüksek olduğundan winH*0.8 + ortalama,
  // header/kapat butonunu durum çubuğu / kamera çentiği (safe area) altına
  // itiyordu. Tablet'te: biraz küçült + güvenli alana sığdır. Ortalı modal'ın
  // bir kenardan taşmaması için yükseklik en fazla `ekran - 2*(en büyük dikey
  // inset)`; genişlikte de yatay inset düşülür. Ayrıca mutlak tavanla küçültülür
  // (büyük tablette dev kamera modalı gereksiz).
  const vInset = Math.max(insets.top, insets.bottom);
  const hInset = Math.max(insets.left, insets.right);
  // Tablet: kare modal (genişlik = yükseklik) — kenarlar eşit. Tek `side`
  // tüm sınırların en küçüğü: yatay/dikey güvenli alan + mutlak tavan.
  const tabletSide = Math.min(
    winW * 0.6,
    winW - 2 * hInset - 16,
    winH * 0.78,
    winH - 2 * vInset - 16,
    560,
  );
  const sheetSize = isTablet
    ? { width: tabletSide, height: tabletSide }
    : { width: winW * 0.7, height: winH * 0.8 };

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
      <View style={[styles.sheet, sheetSize]}>
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
