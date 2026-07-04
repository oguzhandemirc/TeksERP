// =============================================================================
// Çıkış / kullanıcı geçişi sırası — SAF-ish, enjekte bağımlılıklı (unit test)
// =============================================================================
// Paylaşımlı tablette operatör A çıkarken/operatör B'ye geçerken SIRA yük taşır:
//
//   1) ONLINE ise ÖNCE `resumePausedMutations()` — A'nın kuyruktaki istasyon
//      yazımları A'nın HÂLÂ GEÇERLİ token'ıyla gönderilir (token her istekte
//      `api.ts` tarafından TAZE okunur → clearAuth'tan ÖNCE flush şart).
//   2) closeSession() — A'nın çalışma oturumu temiz kapanır (LOGOUT/NEW_LOGIN).
//   3) resetSession() — yerel oturum state'i sıfırlanır.
//   4) queryClient.clear() — A'nın OKUMA cache'i düşer (B, A'nın listelerini
//      görmesin); flush'tan SONRA yapılır ki (1) kuyruğu boşaltılmış olsun.
//   5a) LOGOUT: clearAuth() (adım 4'ten önce, token silinir).
//   5b) SWITCH: setAuth(B) + initSession() (yeni operatör yüklenir).
//
// Fonksiyonlar bağımlılıkları PARAMETRE olarak alır → React/store/queryClient'a
// doğrudan bağlı değil, jest'te mock'larla sıra doğrulanır.
// =============================================================================

import type { JwtPayload } from '../types/auth';

export interface FlushDeps {
  /** Şu an çevrimiçi mi? Offline ise flush atlanır (paused kuyruk beklemede kalır). */
  isOnline: () => boolean;
  /** TanStack Query: kuyruktaki paused mutation'ları çalıştır (A token'ıyla). */
  resumePausedMutations: () => Promise<unknown>;
  /** TanStack Query okuma cache'ini boşalt. */
  clearQueryCache: () => void;
  /** Çalışma oturumunu kapat (best-effort — offline'da yerel state yine temizlenir). */
  closeSession: () => Promise<void>;
  /** Yerel oturum store'unu sıfırla. */
  resetSession: () => void;
}

export interface LogoutDeps extends FlushDeps {
  /** Token + kullanıcıyı sil (login ekranına döner). */
  clearAuth: () => Promise<void>;
}

export interface SwitchDeps extends FlushDeps {
  /** Yeni operatörü kalıcılaştır (fullName banner için companion). */
  setAuth: (user: JwtPayload, token: string, fullName?: string) => Promise<void>;
  /** Yeni operatörün oturum durumunu yükle (SessionGate yer sorar). */
  initSession: () => Promise<void>;
}

async function flushIfOnline(deps: FlushDeps): Promise<void> {
  if (!deps.isOnline()) return;
  try {
    await deps.resumePausedMutations();
  } catch {
    // Flush best-effort — kuyruk online olunca yine denenir; çıkışı bloklamaz.
  }
}

/**
 * Çıkış: flush → closeSession → resetSession → clearAuth → clearQueryCache.
 * clear() EN SON (A okuma cache'i), clearAuth'tan sonra.
 */
export async function flushThenLogout(deps: LogoutDeps): Promise<void> {
  await flushIfOnline(deps);
  await deps.closeSession();
  deps.resetSession();
  await deps.clearAuth();
  deps.clearQueryCache();
}

/**
 * Hızlı geçiş (A→B): flush → closeSession → resetSession → clearQueryCache →
 * setAuth(B) → initSession. clear() setAuth'tan ÖNCE (A cache'i B yüklenmeden düşer).
 */
export async function flushThenSwitch(
  deps: SwitchDeps,
  next: { user: JwtPayload; token: string; fullName?: string },
): Promise<void> {
  await flushIfOnline(deps);
  await deps.closeSession();
  deps.resetSession();
  deps.clearQueryCache();
  await deps.setAuth(next.user, next.token, next.fullName);
  await deps.initSession();
}
