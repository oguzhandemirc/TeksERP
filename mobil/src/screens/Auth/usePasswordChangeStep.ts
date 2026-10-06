// =============================================================================
// Zorunlu parola değişimi adımı (tablet) — yönetici parolayı sıfırladığında hesap
// `mustChangePassword` taşır ve kullanıcı kendi parolasını belirlemeden giremez.
//
// İki giriş kapısı:
//   · parolalı giriş 200 + `mustChangePassword` → kısıtlı token + mevcut parola elde;
//     adım yalnız yeni parolayı sorar.
//   · PIN / kart 403 PASSWORD_CHANGE_REQUIRED (+ `details.username`) → parola elde değil;
//     adım geçici parolayı da sorar, önce değişim adımlı parolalı girişle token alır.
// Token YALNIZ bellekte durur (sunucu ona me/logout/change-password açar). Başarılı
// değişim bütün oturumları kapatır → `resume` asıl girişi tekrarlar.
// =============================================================================

import { useCallback, useState } from 'react';
import { authService } from '../../services/auth.service';

export interface PasswordChangeRequest {
  username: string;
  /** Parolalı girişte elde olan (geçici) parola; yoksa adım kullanıcıdan ister. */
  currentPassword?: string;
  /** Parolalı girişin kısıtlı token'ı; yoksa adım değişim adımlı girişle alır. */
  token?: string;
  /** Değişimden sonra asıl girişi tekrarla (yeni parolayla ya da PIN/kartla). */
  resume: (newPassword: string) => Promise<void>;
}

export interface PasswordChangeInput {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** PIN/kart girişinin 403 PASSWORD_CHANGE_REQUIRED cevabındaki kullanıcı adı (yoksa null). */
export function passwordChangeUsername(err: unknown): string | null {
  const e = err as { status?: number; details?: { code?: string; username?: unknown } } | null;
  if (e?.status !== 403 || e?.details?.code !== 'PASSWORD_CHANGE_REQUIRED') return null;
  return typeof e.details.username === 'string' && e.details.username ? e.details.username : null;
}

export function usePasswordChangeStep() {
  const [pending, setPending] = useState<PasswordChangeRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Adımın kendi aldığı kısıtlı token (PIN/kart dalı) — vazgeçişte oturumu kapatmak için.
  const [ownToken, setOwnToken] = useState<string | null>(null);

  const open = useCallback((req: PasswordChangeRequest) => {
    setPending(req);
    setError(null);
    setOwnToken(null);
  }, []);

  const submit = useCallback(
    async (input: PasswordChangeInput): Promise<boolean> => {
      if (!pending || submitting) return false;
      const current = pending.currentPassword ?? input.currentPassword;
      if (!current) {
        setError('Size verilen parolayı girin.');
        return false;
      }
      if (!input.newPassword) {
        setError('Yeni parolayı girin.');
        return false;
      }
      if (input.newPassword !== input.confirm) {
        setError('Yeni parolalar eşleşmiyor.');
        return false;
      }
      setSubmitting(true);
      setError(null);
      try {
        let token = pending.token ?? ownToken;
        if (!token) {
          const res = await authService.login({ username: pending.username, password: current });
          if (res.data.mustChangePassword !== true) {
            // Bu arada başka yerden değişmiş: verilen parola zaten geçerli, asıl girişe dön.
            setPending(null);
            await pending.resume(current);
            return true;
          }
          token = res.data.token;
          setOwnToken(token);
        }
        await authService.changePassword(token, current, input.newPassword);
      } catch (e) {
        // Adımda KAL: kullanıcı düzeltip yeniden dener (politika · yanlış parola · ağ).
        setError(messageOf(e, 'Parola değiştirilemedi.'));
        return false;
      } finally {
        setSubmitting(false);
      }
      const req = pending;
      setPending(null);
      setOwnToken(null);
      await req.resume(input.newPassword);
      return true;
    },
    [pending, submitting, ownToken],
  );

  const cancel = useCallback(() => {
    const token = pending?.token ?? ownToken;
    if (token) void authService.logoutToken(token).catch(() => undefined);
    setPending(null);
    setOwnToken(null);
    setError(null);
  }, [pending, ownToken]);

  return { pending, submitting, error, open, submit, cancel };
}
