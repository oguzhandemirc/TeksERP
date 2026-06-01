import { Dimensions, useWindowDimensions } from 'react-native';

// =============================================================================
// useFullscreenModalProps — react-native-modal backdrop'unu TÜM fiziksel ekrana
// yayar (Android alt navigasyon çubuğu + üst durum çubuğu dahil).
//
// Sorun: rn-modal'da backdrop View'i `deviceHeight` kadar yüksek; default'u
// `Dimensions.get('window')` = sistem çubukları HARİÇ ölçü. Edge-to-edge
// (Android 15) ile uygulama nav bar altına çizdiği için backdrop kısa kalıyor
// ve altta (nav bar şeridinde) siyah perdenin olmadığı bir boşluk görünüyor.
//
// Çözüm: backdrop'u `screen` (gerçek ekran) boyutuna sabitle + native Modal'ı
// status/navigation bar altına çizdir (translucent). `navigationBarTranslucent`
// rn-modal tipinde olmasa da `otherProps` ile RN <Modal>'a iletilir (RN 0.76+).
//
// Rotation'da yeniden hesaplansın diye `useWindowDimensions` ile re-render'a
// bağlıdır. Kullanım: `<RNModal {...useFullscreenModalProps()} ...diğer />`
// (zaten varsa deviceWidth/deviceHeight/statusBarTranslucent prop'larını kaldır).
// =============================================================================
export function useFullscreenModalProps() {
  // Değeri kullanmasak da rotation'da bu hook'u çağıran bileşeni re-render eder
  // → aşağıdaki `screen` ölçüsü taze okunur.
  useWindowDimensions();
  const screen = Dimensions.get('screen');
  return {
    deviceWidth: screen.width,
    deviceHeight: screen.height,
    statusBarTranslucent: true,
    navigationBarTranslucent: true,
  };
}
