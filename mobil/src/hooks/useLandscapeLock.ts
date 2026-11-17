import { useEffect } from 'react';
import { acquireOrientationLock } from './orientationLock';

/**
 * Tablet-only ekranlar için landscape kilidi. `enabled=false` verilirse
 * (örn. KK1 telefonda) kilide dokunulmaz — kullanıcı serbestçe döner.
 * Çıkışta kilit bırakılır; yatay isteyen başka ekran hâlâ açıksa onunki sürer.
 */
export function useLandscapeLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    return acquireOrientationLock('LANDSCAPE');
  }, [enabled]);
}
