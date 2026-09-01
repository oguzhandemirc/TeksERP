import type { AxiosError } from "axios";

// -----------------------------------------------------------------------------
// İKİ ADIMLI DOĞRULAMA — hata kodu dedektörleri (saf, React'ten bağımsız)
// -----------------------------------------------------------------------------
// Backend uzak (tünel) girişlerde ikinci faktör ister ve ÜÇ FARKLI durumu ÜÇ
// FARKLI HTTP koduyla ayırır. Ayrım keyfi değil, giriş kilidine bağlı: kilit
// yalnız **401**'i kaba kuvvet sayar (`auth.controller` F49 kuralı).
//
//   • 403 TOTP_ENROLLMENT_REQUIRED → 2FA hiç kurulmamış. Kimlik denemesi DEĞİL.
//   • 409 TOTP_REQUIRED            → kod istendi. Kimlik denemesi DEĞİL.
//   • 401 TOTP_INVALID             → yanlış kod. SAYILIR ve sayılmalı (TOTP uzayı
//                                    yalnız 10^6; kilitsiz çevrimiçi tahmin edilebilir).
//
// ⚠️ Bu kodlar LAN'da HİÇ görülmez — fabrika girişleri hiç değişmedi.
// -----------------------------------------------------------------------------

export const TOTP_REQUIRED_CODE = "TOTP_REQUIRED";
export const TOTP_ENROLLMENT_REQUIRED_CODE = "TOTP_ENROLLMENT_REQUIRED";
export const TOTP_INVALID_CODE = "TOTP_INVALID";

interface TotpErrorBody {
  message?: string;
  details?: { code?: string };
}

/** Hatanın `details.code` alanı — yoksa null. */
function readCode(error: unknown): { status?: number; code: string | null } {
  const err = error as AxiosError<TotpErrorBody> | undefined;
  const resp = err?.response;
  return { status: resp?.status, code: resp?.data?.details?.code ?? null };
}

/** Sunucu ikinci faktör kodu istiyor mu (409)? */
export function isTotpRequired(error: unknown): boolean {
  const { status, code } = readCode(error);
  return status === 409 && code === TOTP_REQUIRED_CODE;
}

/** Kullanıcının 2FA'sı hiç kurulmamış mı (403)? */
export function isTotpEnrollmentRequired(error: unknown): boolean {
  const { status, code } = readCode(error);
  return status === 403 && code === TOTP_ENROLLMENT_REQUIRED_CODE;
}

/** Girilen kod yanlış mı (401)? */
export function isTotpInvalid(error: unknown): boolean {
  const { status, code } = readCode(error);
  return status === 401 && code === TOTP_INVALID_CODE;
}
