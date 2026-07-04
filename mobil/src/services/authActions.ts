// =============================================================================
// Paylaşımlı login aksiyonları — clientType + SESSION_EXISTS (kick) yeniden dene
// =============================================================================
// Hem LoginScreen hem kilit ekranı (LockOverlay) buradan geçer. `authService.*`
// zaten gövdeye `clientType:'mobile'` ekler; burada 'notify' politikasının
// 409 SESSION_EXISTS çakışmasını yönetiriz:
//   1) confirmKick'siz dene.
//   2) 409 SESSION_EXISTS gelirse → çağıranın verdiği onConflict resolver'ı sor.
//   3) Onaylanırsa confirmKick=true ile tekrar dene (iki oturum da açık kalır).
// 'kick' (mobil default) politikasında backend 409 dönmez → onConflict hiç
// çağrılmaz (eski oturum sessizce düşer).
// =============================================================================

import { authService } from './auth.service';
import type { LoginResponse, ExistingSessionInfo } from '../types/auth';

/** Çakışmayı çöz: kullanıcı iki oturumu da açık tutmak istiyor mu? */
export type ConflictResolver = (
  existing: ExistingSessionInfo | null,
) => Promise<boolean>;

/** Hata SESSION_EXISTS mi? Öyleyse mevcut oturum bilgisi (yoksa null); değilse undefined. */
function sessionExistsInfo(e: unknown): ExistingSessionInfo | null | undefined {
  const err = e as {
    status?: number;
    details?: { code?: string; existingSession?: ExistingSessionInfo };
  };
  if (err?.status === 409 && err.details?.code === 'SESSION_EXISTS') {
    return err.details.existingSession ?? null;
  }
  return undefined;
}

async function withKickRetry(
  call: (confirmKick?: boolean) => Promise<LoginResponse>,
  onConflict?: ConflictResolver,
): Promise<LoginResponse> {
  try {
    return await call(undefined);
  } catch (e) {
    const existing = sessionExistsInfo(e);
    if (existing !== undefined) {
      const proceed = onConflict ? await onConflict(existing) : true;
      if (proceed) return await call(true);
    }
    throw e;
  }
}

export const authActions = {
  password: (username: string, password: string, onConflict?: ConflictResolver) =>
    withKickRetry(
      (confirmKick) => authService.login({ username, password, confirmKick }),
      onConflict,
    ),
  quickPin: (pin: string, onConflict?: ConflictResolver) =>
    withKickRetry((confirmKick) => authService.loginWithQuickPin(pin, confirmKick), onConflict),
  card: (cardCode: string, onConflict?: ConflictResolver) =>
    withKickRetry((confirmKick) => authService.loginWithCard(cardCode, confirmKick), onConflict),
};
