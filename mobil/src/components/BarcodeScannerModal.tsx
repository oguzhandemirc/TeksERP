import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button } from 'react-native-paper';
import AppModal from './AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarcodeScannerView, type SupportedBarcodeType } from './BarcodeScannerView';
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
  /** Başlık altında vurgulu uyarı bandı. */
  notice?: string;
  /** Canlı karşılama sayacı (metre): okutulan / istenen — fazlada gerçek rakam, kısıtlama yok. */
  counter?: { scanned: number; expected: number };
  /** Yakalama anında "başarı" haptiği (default true). Çağıran kendi kabul/ret
   *  titreşimini veriyorsa false geç (çift titreşim olmasın). bkz. BarcodeScannerView. */
  captureHaptic?: boolean;
  /** O15: verilirse kameranın altında "Listeden Seç" butonu çıkar — proje
   *  kuralı: top okutulan her ekranda listeden seçim alternatifi olmalı
   *  (kamera çalışmasa/etiket okunmasa da akış kilitlenmez). */
  onPickFromList?: () => void;
  /** Kameranın başlangıç yönü (BarcodeScannerView'e geçer). Default 'back';
   *  sabit tablette önden okutmak için 'front' geç. Flip butonu her zaman var. */
  initialFacing?: 'front' | 'back';
  /** Okuma tetikleyicisi — `'tap'` ile kamera yalnız "OKUT" tuşuna basılınca
   *  tek okuma yapar. bkz. BarcodeScannerView.trigger. Default 'auto'. */
  trigger?: 'auto' | 'tap';
  /** Kameranın ALTINDA sabit yükseklikli şerit (örn. "son okutulanlar" listesi).
   *  Verilirse sheet biraz büyür ki kamera kadrajı ezilmesin. */
  footer?: React.ReactNode;
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
  notice,
  counter,
  captureHaptic,
  onPickFromList,
  initialFacing,
  trigger,
  footer,
}: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isTablet = useDeviceType() === 'tablet';

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
  // Alt şerit varsa (son okutulanlar) kamera alanı ezilmesin: telefonda sheet
  // genişler/uzar, tablette kare sheet şerit kadar uzar. Şeritsiz kullanımlarda
  // ölçüler bugünküyle BİREBİR aynı kalır.
  const hasFooter = !!footer;
  const sheetSize = isTablet
    ? {
        width: tabletSide,
        height: hasFooter
          ? Math.min(tabletSide + FOOTER_H, winH - 2 * vInset - 16)
          : tabletSide,
      }
    : {
        width: winW * (hasFooter ? 0.9 : 0.7),
        height: winH * (hasFooter ? 0.86 : 0.8),
      };

  return (
    <AppModal
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onModalHide}
      // Sheet kendi genişliğini verir; AppModal'a bildirmezsek center modundaki
      // contentBase (min(ekran-32,560)) dış sarmalayıcıyı daha geniş yapar ve
      // dar sheet içinde sola yaslı kalır (modal sola kayar). contentStyle ile
      // dış sarmalayıcıyı sheet genişliğine sabitleyip ortalıyoruz.
      contentStyle={{ width: sheetSize.width }}
    >
      <View style={[styles.sheet, sheetSize]}>
        {/* Kamera + üzerindeki "Listeden Seç" ayrı bir katmanda: şerit eklendiğinde
            absolute buton şeridin üstüne binmesin diye sarmalayıcı gerekiyor. */}
        <View style={styles.cameraLayer}>
          <BarcodeScannerView
            active={visible}
            onClose={onDismiss}
            onScan={onScan}
            title={title}
            barcodeTypes={barcodeTypes}
            continuous={continuous}
            notice={notice}
            counter={counter}
            captureHaptic={captureHaptic}
            initialFacing={initialFacing}
            trigger={trigger}
          />
          {onPickFromList && (
            <View style={styles.pickRow}>
              <Button
                mode="contained-tonal"
                icon="format-list-bulleted"
                onPress={() => {
                  onDismiss();
                  onPickFromList();
                }}
              >
                Listeden Seç
              </Button>
            </View>
          )}
        </View>
        {footer}
      </View>
    </AppModal>
  );
}

/** Alt şeridin (son okutulanlar) hesapta kullanılan yüksekliği. */
const FOOTER_H = 156;

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    overflow: 'hidden',
  },
  cameraLayer: { flex: 1, position: 'relative' },
  pickRow: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
