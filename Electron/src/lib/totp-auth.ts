import type { AxiosError } from "axios";

// -----------------------------------------------------------------------------
// İKİ ADIMLI DOĞRULAMA — hata kodu dedektörleri (saf, React'ten bağımsız)
// -----------------------------------------------------------------------------
// Backend, hesabında 2FA açık kullanıcının PAROLALI girişinde ikinci faktör ister
// (isteğe bağlı; kimseye zorunlu değil) ve ÜÇ FARKLI durumu ÜÇ
// FARKLI HTTP koduyla ayırır. Ayrım keyfi değil, giriş kilidine bağlı: kilit
// yalnız **401**'i kaba kuvvet sayar (`auth.controller` F49 kuralı).
//
//   • 403 TOTP_ENROLLMENT_REQUIRED → 2FA hiç kurulmamış (zorunluluk yok → bugün dönmez).
//   • 409 TOTP_REQUIRED            → kod istendi. Kimlik denemesi DEĞİL.
//   • 401 TOTP_INVALID             → yanlış kod. SAYILIR ve sayılmalı (TOTP uzayı
//                                    yalnız 10^6; kilitsiz çevrimiçi tahmin edilebilir).
//
// 2FA'sı kapalı hesap bu kodları hiç görmez; PIN/kart girişleri de sorulmaz.
// -----------------------------------------------------------------------------

/** 2FA sekmesinin açıklaması — isteğe bağlı 2FA sözleşmesi (kullanıcı kararı 2026-09-30). */
export const TWO_FACTOR_HINT =
  "İki adımlı doğrulama isteğe bağlıdır: açarsanız bu hesabın her parolalı girişinde " +
  "telefondaki kod sorulur. Kapalıyken sorulmaz. Tabletteki PIN ve kart girişleri etkilenmez.";

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
