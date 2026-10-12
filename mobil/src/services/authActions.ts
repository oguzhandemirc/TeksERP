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
//
// İKİNCİ FAKTÖR (Y-02, 2026-10-13): 409 TOTP_REQUIRED → onTotp resolver'ı kodu sorar,
// istek `totpCode` ile tekrarlanır; 401 TOTP_INVALID → kod yeniden sorulur. Süperadminde
// PIN/kart girişinde hep, diğerlerinde ayar açıksa gelir. Resolver yoksa hata aynen fırlar.
// =============================================================================

import { authService } from './auth.service';
import type { LoginResponse, ExistingSessionInfo } from '../types/auth';

/** Çakışmayı çöz: kullanıcı iki oturumu da açık tutmak istiyor mu? */
export type ConflictResolver = (
  existing: ExistingSessionInfo | null,
) => Promise<boolean>;

/** İkinci faktör kodunu sor: `invalid` = önceki kod reddedildi. null = kullanıcı vazgeçti. */
export type TotpResolver = (invalid: boolean) => Promise<string | null>;

/** Kullanıcı kod adımından vazgeçti — giriş yapılmadı. */
export const TOTP_CANCELLED_MESSAGE = 'Doğrulama kodu girilmedi — giriş yapılmadı.';

/** Hata ikinci faktör adımı mı: 409 TOTP_REQUIRED → 'required', 401 TOTP_INVALID → 'invalid'. */
export function totpErrorKind(e: unknown): 'required' | 'invalid' | null {
  const err = e as { status?: number; details?: { code?: string } };
  if (err?.status === 409 && err.details?.code === 'TOTP_REQUIRED') return 'required';
  if (err?.status === 401 && err.details?.code === 'TOTP_INVALID') return 'invalid';
  return null;
}

async function withTotpRetry(
  call: (totpCode?: string) => Promise<LoginResponse>,
  onTotp?: TotpResolver,
): Promise<LoginResponse> {
  let code: string | undefined;
  for (;;) {
    try {
      return await call(code);
    } catch (e) {
      const kind = totpErrorKind(e);
      // Kod hiç gönderilmeden gelen TOTP_INVALID bizim adımımız değil — aynen fırlat.
      if (!onTotp || !kind || (kind === 'invalid' && code === undefined)) throw e;
      const next = (await onTotp(kind === 'invalid'))?.trim();
      if (!next) throw new Error(TOTP_CANCELLED_MESSAGE);
      code = next;
    }
  }
}

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

// Kod yalnız varken argümana girer (kodsuz çağrı imzası eskisiyle aynı kalır).
export const authActions = {
  password: (username: string, password: string, onConflict?: ConflictResolver, onTotp?: TotpResolver) =>
    withTotpRetry(
      (totpCode) =>
        withKickRetry(
          (confirmKick) =>
            authService.login({ username, password, confirmKick, ...(totpCode ? { totpCode } : {}) }),
          onConflict,
        ),
      onTotp,
    ),
  quickPin: (pin: string, onConflict?: ConflictResolver, onTotp?: TotpResolver) =>
    withTotpRetry(
      (totpCode) =>
        withKickRetry(
          (confirmKick) =>
            totpCode
              ? authService.loginWithQuickPin(pin, confirmKick, totpCode)
              : authService.loginWithQuickPin(pin, confirmKick),
          onConflict,
        ),
      onTotp,
    ),
  card: (cardCode: string, onConflict?: ConflictResolver, onTotp?: TotpResolver) =>
    withTotpRetry(
      (totpCode) =>
        withKickRetry(
          (confirmKick) =>
            totpCode
              ? authService.loginWithCard(cardCode, confirmKick, totpCode)
              : authService.loginWithCard(cardCode, confirmKick),
          onConflict,
        ),
      onTotp,
    ),
};
