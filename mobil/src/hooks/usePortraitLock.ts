import { useEffect } from 'react';
import { acquireOrientationLock } from './orientationLock';

/**
 * Telefon-dikey ekranlar için portrait kilidi (Tartı/Paket, Sevkiyat — saha,
 * elde telefon). `enabled=false` verilirse kilit uygulanmaz.
 */
export function usePortraitLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    return acquireOrientationLock('PORTRAIT_UP');
  }, [enabled]);
}
