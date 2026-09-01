import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

/**
 * 2FA KURULUM UÇLARI — kimlik GEREKTİRMEZ ve bu bilinçlidir.
 *
 * Kurulumu yapacak kişi tanımı gereği HENÜZ GİREMEYEN kişidir: uzaktan giriş
 * TOTP olmadan reddediliyor, TOTP de buradan kuruluyor. Guard takmak "kilidi
 * açmak için içeride olmalısın" döngüsü kurardı.
 *
 * Koruma kimlik değil TOKEN'dır: tek kullanımlık, 15 dk ömürlü ve yalnız
 * `admin:users` taşıyan biri üretebilir.
 */
export interface TotpEnrollInfo {
  username: string;
  otpauthUri: string;
  /** QR okutamayan cihazlar için elle giriş — tek çıkış yolu. */
  secret: string;
  expiresAt: string;
}

export interface TotpEnrollResult {
  username: string;
  /** YALNIZ BURADA, bir kez döner. Sunucuda hash'li saklanır. */
  recoveryCodes: string[];
}

export const totpEnrollService = {
  read: (token: string): Promise<ApiResponse<TotpEnrollInfo>> =>
    apiClient
      .get<ApiResponse<TotpEnrollInfo>>("/api/auth/totp/enroll", {
        params: { token },
        suppressErrorToast: true,
      })
      .then((r) => r.data),

  consume: (token: string, code: string): Promise<ApiResponse<TotpEnrollResult>> =>
    apiClient
      .post<ApiResponse<TotpEnrollResult>>(
        "/api/auth/totp/enroll",
        { token, code },
        { suppressErrorToast: true },
      )
      .then((r) => r.data),
};
