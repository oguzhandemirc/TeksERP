// =============================================================================
// Çıkış / kullanıcı geçişi sırası — SAF-ish, enjekte bağımlılıklı (unit test)
// =============================================================================
// Paylaşımlı tablette operatör A çıkarken/operatör B'ye geçerken SIRA yük taşır:
//
//   1) ONLINE ise ÖNCE `resumePausedMutations()` — A'nın kuyruktaki istasyon
//      yazımları A'nın HÂLÂ GEÇERLİ token'ıyla gönderilir. Ancak bekleme
//      TAVANLIDIR (FLUSH_DEADLINE_MS): parazitli sahada takılı tek kayıt
//      çıkışı 20-60sn kilitliyordu — tavan dolunca kuyruk BEKLEMEDE bırakılır
//      (kayıp yok: mutations.ts NoAuth guard'ı token'sız HTTP atmaz, persist
//      politikası pending-istasyonu da diske yazar; sonraki girişte akar).
//   2) closeSession() — A'nın çalışma oturumu kapanır (o da tavanlı; POST arka
//      planda sürebilir, sunucudaki oturum NEW_LOGIN/idle ile zaten kapanır).
//   3) resetSession() — yerel oturum state'i sıfırlanır.
//   4) clearQueryCache() — SEÇİCİ temizlik (sessionSwitch.clearUserScopedQueries):
//      kullanıcıya özel OKUMA query'leri düşer; public bootstrap korunur (login
//      ekranı anında çizilir). MUTATION CACHE'E ASLA DOKUNMAZ — queryClient.clear()
//      kullanılsaydı tavanla bekletilen kuyruk YOK OLURDU.
//   5a) LOGOUT: clearAuth() (adım 4'ten önce, token silinir).
//   5b) SWITCH: (4) → setAuth(B) + initSession() (yeni operatör yüklenir).
//
// Fonksiyonlar bağımlılıkları PARAMETRE olarak alır → React/store/queryClient'a
// doğrudan bağlı değil, jest'te mock'larla sıra + tavan davranışı doğrulanır.
// =============================================================================

import type { JwtPayload } from '../types/auth';
import { withDeadline } from './deadline';

/** Kuyruk flush'ı için bekleme tavanı — sahada çıkışın hissedilir üst sınırı. */
export const FLUSH_DEADLINE_MS = 5_000;
/** work-session close bekleme tavanı. */
export const CLOSE_DEADLINE_MS = 4_000;

export interface FlushDeps {
  /** Şu an çevrimiçi mi? Offline ise flush atlanır (paused kuyruk beklemede kalır). */
  isOnline: () => boolean;
  /** TanStack Query: kuyruktaki paused mutation'ları çalıştır (A token'ıyla). */
  resumePausedMutations: () => Promise<unknown>;
  /** Kullanıcıya özel okuma query'lerini düşür (mutation cache'e DOKUNMAZ). */
  clearQueryCache: () => void;
  /** Çalışma oturumunu kapat (best-effort — offline'da yerel state yine temizlenir). */
  closeSession: () => Promise<void>;
  /** Yerel oturum store'unu sıfırla. */
  resetSession: () => void;
  /** Kuyrukta bekleyen istasyon yazımı sayısı (çıkış sonucu raporu için). */
  pendingStationOps: () => number;
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

export interface FlushOpts {
  flushDeadlineMs?: number;
  closeDeadlineMs?: number;
}

export interface FlushOutcome {
  /** Flush tavana takıldı mı? (bilgi amaçlı — akış her durumda tamamlanır) */
  flushTimedOut: boolean;
  /** Çıkış anında hâlâ kuyrukta bekleyen istasyon kaydı sayısı. */
  pendingCount: number;
}

/** Flush: online ise tavanlı bekle; hata/timeout çıkışı bloklamaz. */
async function flushIfOnline(deps: FlushDeps, deadlineMs: number): Promise<boolean> {
  if (!deps.isOnline()) return false;
  // resumePausedMutations reject ederse withDeadline yutar (best-effort).
  const r = await withDeadline(deps.resumePausedMutations(), deadlineMs);
  return r.timedOut;
}

/**
 * Çıkış: tavanlı flush → tavanlı closeSession → resetSession → clearAuth →
 * seçici cache temizliği. Dönen FlushOutcome ile UI "N kayıt bekletildi" der.
 */
export async function flushThenLogout(
  deps: LogoutDeps,
  opts: FlushOpts = {},
): Promise<FlushOutcome> {
  const flushTimedOut = await flushIfOnline(deps, opts.flushDeadlineMs ?? FLUSH_DEADLINE_MS);
  await withDeadline(deps.closeSession(), opts.closeDeadlineMs ?? CLOSE_DEADLINE_MS);
  deps.resetSession();
  await deps.clearAuth();
  deps.clearQueryCache();
  return { flushTimedOut, pendingCount: deps.pendingStationOps() };
}

/**
 * Hızlı geçiş (A→B): tavanlı flush → tavanlı closeSession → resetSession →
 * clearQueryCache → setAuth(B) → initSession. clear() setAuth'tan ÖNCE (A'nın
 * kullanıcıya özel cache'i B yüklenmeden düşer). NOT: A'dan kalan bekletilmiş
 * kuyruk B'nin token'ıyla gider — app-restart sonrası resume ile aynı, bilinçli
 * kabul (SAHA-AG-DAYANIKLILIK.md §S1).
 */
export async function flushThenSwitch(
  deps: SwitchDeps,
  next: { user: JwtPayload; token: string; fullName?: string },
  opts: FlushOpts = {},
): Promise<FlushOutcome> {
  const flushTimedOut = await flushIfOnline(deps, opts.flushDeadlineMs ?? FLUSH_DEADLINE_MS);
  await withDeadline(deps.closeSession(), opts.closeDeadlineMs ?? CLOSE_DEADLINE_MS);
  deps.resetSession();
  deps.clearQueryCache();
  await deps.setAuth(next.user, next.token, next.fullName);
  await deps.initSession();
  return { flushTimedOut, pendingCount: deps.pendingStationOps() };
}
