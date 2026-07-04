// =============================================================================
// Idle kilit reducer'ı — SAF mantık (UI'dan bağımsız, unit test edilir)
// =============================================================================
// Paylaşımlı saha tabletinde operatör oturumu açık bırakıp uzaklaşırsa ekran
// kilitlenmeli. Bu modül YALNIZ kararı verir: son aktiviteden bu yana geçen
// süreye göre faz `active | warning | locked`. Zamanlayıcı/AppState/overlay
// tarafı (`useIdleLock`) bu saf fonksiyonu çağırır; burada React/timer YOK.
//
//   |------------------ idleMs ------------------|
//   active .................. warning ...... locked
//                          (son warnMs)      (süre doldu)
//
// warning fazında geri sayım (saniye) gösterilir + "Devam et" ile aktiviteye
// dönülür (lastActivityTs sıfırlanır → faz `active`).
// =============================================================================

export type IdlePhase = 'active' | 'warning' | 'locked';

export interface IdleState {
  phase: IdlePhase;
  /** Kilide kalan süre (ms). `locked` fazında 0. */
  msUntilLock: number;
}

/**
 * Son aktivite + şimdiki zaman + eşiklerden fazı hesaplar. Tamamen saf:
 * aynı girdi → aynı çıktı.
 *
 * @param lastActivityTs Son dokunma zamanı (epoch ms).
 * @param now            Şimdiki zaman (epoch ms).
 * @param idleMs         Kilit eşiği (ms). Bu kadar hareketsizlikte kilit.
 * @param warnMs         Kilitten kaç ms önce uyarı/geri sayım gösterilsin.
 */
export function computeIdlePhase(
  lastActivityTs: number,
  now: number,
  idleMs: number,
  warnMs: number,
): IdleState {
  // Negatif elapsed (saat geri gitmesi / gelecek ts) korunur → aktivite say.
  const elapsed = Math.max(0, now - lastActivityTs);
  const msUntilLock = idleMs - elapsed;
  if (msUntilLock <= 0) return { phase: 'locked', msUntilLock: 0 };
  if (msUntilLock <= warnMs) return { phase: 'warning', msUntilLock };
  return { phase: 'active', msUntilLock };
}

/** Geri sayım için gösterilecek tam saniye (yukarı yuvarlanır, min 0). */
export function warningSeconds(msUntilLock: number): number {
  return Math.max(0, Math.ceil(msUntilLock / 1000));
}

/** Uyarı penceresi süresi (ms) — kilitten önce "Devam et" geri sayımı. */
export const IDLE_WARNING_MS = 20_000;

/** Dakika ayarını güvenli ms'e çevirir (1..120 dk clamp; geçersiz → default). */
export function idleMinutesToMs(minutes: number | undefined, fallbackMinutes = 10): number {
  const m =
    typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
      ? Math.min(120, Math.max(1, minutes))
      : fallbackMinutes;
  return m * 60_000;
}
