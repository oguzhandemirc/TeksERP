import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';

/**
 * Telefon-dikey ekranlar için portrait kilidi (Tartı/Paket, Sevkiyat — saha,
 * elde telefon). `enabled=false` verilirse kilit uygulanmaz.
 */
export function usePortraitLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    return () => {
      void ScreenOrientation.unlockAsync();
    };
  }, [enabled]);
}
