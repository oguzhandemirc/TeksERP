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
import { isBootstrapQueryKey } from './persistPolicy';
import {
  flushThenLogout,
  flushThenSwitch,
  type LogoutDeps,
  type SwitchDeps,
  type FlushOutcome,
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

/**
 * Logout temizliği: kullanıcıya özel OKUMA query'lerini düşür; public bootstrap
 * anahtarlarını (login ekranı verisi, feature-flag, cihaz durumu) KORU —
 * logout→login ekranı son bilinen veriyle anında çizilir, arkada tazelenir.
 *
 * DİKKAT: queryClient.clear() KULLANILMAZ — o mutation cache'i de siler ve
 * tavanla bekletilen istasyon kuyruğunu (outbox) yok ederdi. removeQueries
 * yalnız query cache'ine dokunur.
 */
export function clearUserScopedQueries(): void {
  queryClient.removeQueries({
    predicate: (q) => !isBootstrapQueryKey(q.queryKey),
  });
}

/** Girişten hemen sonra bekletilen kuyruğu dürt — paused mutation'lar taze
 *  token'la hemen akar (NoAuth-bekleyenler zaten ≤15sn içinde kendisi dener). */
export function nudgeOutbox(): void {
  void queryClient.resumePausedMutations();
}

function baseDeps() {
  return {
    isOnline,
    resumePausedMutations: () => queryClient.resumePausedMutations(),
    clearQueryCache: clearUserScopedQueries,
    closeSession: () => useSessionStore.getState().closeSession(),
    resetSession: () => useSessionStore.getState().reset(),
    pendingStationOps: pendingStationOpsCount,
  };
}

/** Çıkış: A token'ıyla TAVANLI flush → oturum kapat → temizle. Sonuçtaki
 *  pendingCount>0 ise UI "N kayıt bekletildi" bilgisi gösterir. */
export function performLogout(): Promise<FlushOutcome> {
  const deps: LogoutDeps = {
    ...baseDeps(),
    clearAuth: () => useAuthStore.getState().clearAuth(),
  };
  return flushThenLogout(deps);
}

/** Hızlı geçiş A→B: A tavanlı flush → A oturum kapat → cache düş → B setAuth → B init. */
export function performSwitch(next: {
  user: JwtPayload;
  token: string;
  fullName?: string;
}): Promise<FlushOutcome> {
  const deps: SwitchDeps = {
    ...baseDeps(),
    setAuth: (u, t, fn) => useAuthStore.getState().setAuth(u, t, fn),
    initSession: () => useSessionStore.getState().init(),
  };
  return flushThenSwitch(deps, next);
}
