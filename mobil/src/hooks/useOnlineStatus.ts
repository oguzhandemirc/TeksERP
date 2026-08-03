import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

/**
 * Canlı bağlantı durumu. `onlineManager.isOnline()` tek seferlik okumadır —
 * bağlantı değişince bileşen yeniden render OLMAZ; bu hook abone olur.
 *
 * Kullanım: bağlantı gerektiren bir eylemi ÖNCEDEN pasifleştirmek / bant basmak.
 * Eylem anındaki `onlineManager.isOnline()` kontrolünün yerine geçmez (yarış payı).
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true, // sunucu render'ı yok; iyimser başla
  );
}
