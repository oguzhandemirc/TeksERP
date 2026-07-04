// =============================================================================
// Oturum geçişi/çıkışı — gerçek bağımlılıkları bağlayan tek nokta
// =============================================================================
// `flushThenLogout` / `flushThenSwitch` saf helper'larına GERÇEK store +
// queryClient bağımlılıklarını verir. UI (ScreenChrome çıkış, LockOverlay hızlı
// geçiş) buradaki `performLogout` / `performSwitch`'i çağırır — sıra/flush
// mantığı tek yerde, UI ince kalır.
// =============================================================================

import { onlineManager } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import { useAuthStore } from '../store/authStore';
import { useSessionStore } from '../store/sessionStore';
import {
  flushThenLogout,
  flushThenSwitch,
  type LogoutDeps,
  type SwitchDeps,
} from './flushThenLogout';
import type { JwtPayload } from '../types/auth';

export function isOnline(): boolean {
  return onlineManager.isOnline();
}

/** Kuyrukta bekleyen (paused/pending) istasyon yazımı sayısı — offline çıkış uyarısı için. */
export function pendingStationOpsCount(): number {
  return queryClient.getMutationCache().findAll({
    status: 'pending',
    predicate: (m) => {
      const k = m.options.mutationKey;
      return Array.isArray(k) && k[0] === 'station';
    },
  }).length;
}

function baseDeps() {
  return {
    isOnline,
    resumePausedMutations: () => queryClient.resumePausedMutations(),
    clearQueryCache: () => queryClient.clear(),
    closeSession: () => useSessionStore.getState().closeSession(),
    resetSession: () => useSessionStore.getState().reset(),
  };
}

/** Çıkış: A token'ıyla flush → oturum kapat → temizle. */
export function performLogout(): Promise<void> {
  const deps: LogoutDeps = {
    ...baseDeps(),
    clearAuth: () => useAuthStore.getState().clearAuth(),
  };
  return flushThenLogout(deps);
}

/** Hızlı geçiş A→B: A flush → A oturum kapat → cache düş → B setAuth → B init. */
export function performSwitch(next: {
  user: JwtPayload;
  token: string;
  fullName?: string;
}): Promise<void> {
  const deps: SwitchDeps = {
    ...baseDeps(),
    setAuth: (u, t, fn) => useAuthStore.getState().setAuth(u, t, fn),
    initSession: () => useSessionStore.getState().init(),
  };
  return flushThenSwitch(deps, next);
}
