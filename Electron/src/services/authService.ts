import type { AxiosRequestConfig } from "axios";
import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { AuthMeResponse, LoginRequest, LoginResponse } from "@/types/auth";
import { IS_ELECTRON } from "@/lib/runtime-env";

/**
 * Bu build hangi istemci tipi olarak giriş yapıyor.
 *
 * ⚠️ AYNI KOD, İKİ HEDEF. `dist-web` build'i (bugün yalnız demo imajı) Electron
 * renderer'ının ta kendisidir; `clientType:"electron"` gönderseydi tarayıcıdan giren
 * masaüstü oturumunu DÜŞÜRÜRDÜ (aynı-tip politikası varsayılanı `kick`). Her hedef
 * kendi oturum yuvasını alır. Bu bir güvenlik sınırı DEĞİLDİR (istemci uydurabilir).
 */
const CLIENT_TYPE = IS_ELECTRON ? "electron" : "web";

/** Public login-methods yanıtının panelin okuduğu alanları. */
export interface LoginMethodsInfo {
  companyName?: string;
  /** K5 giriş sinyali: yalnız zorlamada ve lisans durdurulmuşken true (eski backend göndermez). */
  lisansDurduruldu?: boolean;
}

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

  /**
   * Oturumun SUNUCUDAN çözülen kimliği. Token'da olmayan iki alanı taşır
   * (`isSystemAccount` / `systemAccountExists`) — bkz. `AuthMeResponse`.
   * Genel hata toast'ı bastırılır: bu çağrı arka plandadır, düşerse panel
   * fail-closed varsayılanlarıyla (yazma kapalı) çalışmaya devam eder.
   */
  getMe: (): Promise<ApiResponse<AuthMeResponse>> =>
    apiClient
      .get<ApiResponse<AuthMeResponse>>("/api/auth/me", { suppressErrorToast: true })
      .then((r) => r.data),

  /**
   * Public giriş yöntemleri ucu — giriş ekranı yalnız kurulumun firma adını
   * (`company.name`) okur. Arka plan çağrısı: hata toast'ı bastırılır, düşerse
   * ekran nötr yedeği gösterir.
   */
  getLoginMethods: (): Promise<ApiResponse<LoginMethodsInfo>> =>
    apiClient
      .get<ApiResponse<LoginMethodsInfo>>("/api/auth/login-methods", {
        suppressErrorToast: true,
        timeout: 5_000,
      })
      .then((r) => r.data),
};
