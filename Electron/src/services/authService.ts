import type { AxiosRequestConfig } from "axios";
import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { JwtPayload, LoginRequest, LoginResponse } from "@/types/auth";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * Bu build hangi istemci tipi olarak giriş yapıyor.
 *
 * ⚠️ AYNI KOD, İKİ HEDEF. `dist-web` build'i Electron renderer'ının ta kendisidir
 * ve eskiden o da `clientType:"electron"` gönderiyordu — sonucu, patronun telefon
 * tarayıcısından girince masaüstü oturumunu DÜŞÜRMESİYDİ (aynı-tip politikası
 * varsayılanı `kick`). Artık her hedef kendi oturum yuvasını alıyor.
 *
 * Bu bir güvenlik sınırı DEĞİLDİR (istemci uydurabilir) ve backend de öyle
 * kullanmaz: uzak/LAN ayrımı soket portundan çözülür.
 */
const CLIENT_TYPE = IS_ELECTRON ? "electron" : "web";

export const authService = {
  /**
   * Giriş — gövdeye `clientType` eklenir (Electron'da 'electron', tarayıcıda
   * 'web'; same-type oturum politikası bu ayrımla çalışır). Çağıran `confirmKick` ile 'notify'
   * çakışmasını onaylayabilir. `config` ile per-istek axios ayarı (ör.
   * `suppressErrorToast`) geçilebilir — hata UX'ini çağıran yönetir.
   */
  login: (credentials: LoginRequest, config?: AxiosRequestConfig): Promise<LoginResponse> =>
    apiClient
      .post<LoginResponse>(
        "/api/auth/login",
        { clientType: CLIENT_TYPE, ...credentials },
        config,
      )
      .then((r) => r.data),

  /**
   * Çıkış — bu oturumu backend registry'sinde iptal eder (+ audit). Best-effort:
   * çağıran (auth store) sunucuya ulaşılamasa bile yerel temizliği yapar. Genel
   * hata toast'ı bastırılır; çıkış zaten kullanıcının niyeti.
   *
   * Faz 2 (local-first logout): çağıran token'ı YEREL SİLMEDEN ÖNCE yakalayıp
   * buraya verir — istek arka planda giderken interceptor store'da token
   * bulamayacağı için header'ı buradan taşırız. 3sn timeout: revoke best-effort,
   * UI zaten beklemiyor; asılı sunucuya 15sn bağlı kalmanın anlamı yok.
   */
  logout: (capturedToken?: string): Promise<void> =>
    apiClient
      .post(
        "/api/auth/logout",
        {},
        {
          suppressErrorToast: true,
          timeout: 3_000,
          ...(capturedToken
            ? { headers: { Authorization: `Bearer ${capturedToken}` } }
            : {}),
        },
      )
      .then(() => undefined),

  getMe: (): Promise<ApiResponse<JwtPayload>> =>
    apiClient.get<ApiResponse<JwtPayload>>("/api/auth/me").then((r) => r.data),
};
