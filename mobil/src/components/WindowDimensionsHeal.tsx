// Kökte bir kez bağlanır: pencere ölçüsü kök görünümün gerçek çerçevesiyle YÖN olarak ayrışırsa `Dimensions`ı onarır →
// `useWindowDimensions` okuyan her bileşen (seçiciler, modallar, cihaz sınıfı) doğru ölçüyle yeniden çizilir.
// Neden ve sınır: `lib/windowHeal.ts`.
import { useEffect } from 'react';
import { Dimensions, useWindowDimensions } from 'react-native';
import { useSafeAreaFrame } from 'react-native-safe-area-context';
import { healedWindow } from '../lib/windowHeal';

export default function WindowDimensionsHeal(): null {
  const frame = useSafeAreaFrame();
  const win = useWindowDimensions();
  useEffect(() => {
    const fixed = healedWindow(frame, win);
    if (!fixed) return;
    const screen = Dimensions.get('screen');
    // Ekranı da aynı yöne çevir (yalnız yön ayrışıyorsa); fiziksel boyut değişmez.
    const screenFixed = healedWindow(fixed, { ...screen }) ? { ...screen, width: screen.height, height: screen.width } : screen;
    Dimensions.set({ window: fixed, screen: screenFixed });
  }, [frame, win]);
  return null;
}
