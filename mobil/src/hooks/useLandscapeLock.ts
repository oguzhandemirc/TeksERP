import { useEffect } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useDeviceType } from './useDeviceType';

/**
 * Tablet-only ekranlar için landscape kilidi. `enabled=false` verilirse
 * (örn. KK1 telefonda) hiçbir kilit uygulanmaz — kullanıcı serbestçe döner.
 */
export function useLandscapeLock(enabled: boolean = true) {
  const device = useDeviceType();
  useEffect(() => {
    if (!enabled) {
      void ScreenOrientation.unlockAsync();
      return;
    }
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      // Phone'da yanlışlıkla girilen tablet-only ekrandan çıkışta portrait'e
      // geri dön. Tablet ise landscape'e geri kilitle (default state).
      void ScreenOrientation.lockAsync(
        device === 'phone'
          ? ScreenOrientation.OrientationLock.PORTRAIT_UP
          : ScreenOrientation.OrientationLock.LANDSCAPE,
      );
    };
  }, [device, enabled]);
}
