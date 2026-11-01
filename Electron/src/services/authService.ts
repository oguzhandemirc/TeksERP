import type { AxiosRequestConfig } from "axios";
import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  AuthMeResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  LoginRequest,
  LoginResponse,
} from "@/types/auth";
import { IS_ELECTRON } from "@/lib/runtime-env";

/** Hatırlanan (güvenilir) cihaz — belirteç/özet hiç dönmez. */
export interface TrustedDeviceView {
  id: string;
  label: string;
  firstIp: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  state: "GECERLI" | "SURESI_DOLDU" | "IPTAL" | "GECERSIZ";
}

export interface TrustedDeviceList {
  /** Fabrika ayarı `auth.trustedDeviceDays` (0 = kapalı). */
  days: number;
  devices: TrustedDeviceView[];
}

export interface WebTotpOwnState {
  policy: "REQUIRED" | "USER_CHOICE";
  optOut: boolean;
  effective: boolean;
  totpEnabled: boolean;
  canChange: boolean;
}

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
  /** G2 giriş sinyali: kurulum etkinleştirme kilidinde (yalnız korumalı derleme; eski backend göndermez). */
  lisansEtkinlesmedi?: boolean;
}

/**
 * Webde uçuştaki çıkış isteği. Çerezli oturumda çıkış token yakalayamaz: gecikmiş revoke
 * hemen ardından açılan YENİ oturumun çerezini iptal ederdi → web girişi önce bunu bekler.
 */
let webLogoutInFlight: Promise<unknown> | null = null;

export const authService = {
  /**
   * Giriş — gövdeye `clientType` eklenir (Electron'da 'electron', tarayıcıda
   * 'web'; same-type oturum politikası bu ayrımla çalışır). Çağıran `confirmKick` ile 'notify'
   * çakışmasını onaylayabilir. `config` ile per-istek axios ayarı (ör.
   * `suppressErrorToast`) geçilebilir — hata UX'ini çağıran yönetir.
   */
  login: async (credentials: LoginRequest, config?: AxiosRequestConfig): Promise<LoginResponse> => {
    if (!IS_ELECTRON && webLogoutInFlight) await webLogoutInFlight.catch(() => undefined);
    return apiClient
      .post<LoginResponse>(
        "/api/auth/login",
        { clientType: CLIENT_TYPE, ...credentials },
        config,
      )
      .then((r) => r.data);
  },

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
  logout: (capturedToken?: string | null): Promise<void> => {
    const p = apiClient
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
      .then(() => undefined);
    if (!IS_ELECTRON) {
      const tracked = p.finally(() => {
        if (webLogoutInFlight === tracked) webLogoutInFlight = null;
      });
      webLogoutInFlight = tracked;
    }
    return p;
  },

  /**
   * Kendi parolasını değiştir (zorunlu ilk değişim dahil). Token AÇIKÇA verilir (webde null):
   * zorunlu değişim adımında token kalıcı depoya yazılmamıştır. Başarıda sunucu
   * kullanıcının bütün oturumlarını kapatır → çağıran yeni parolayla yeniden girer.
   * Hata UX'ini çağıran yönetir (`suppressErrorToast`, login deseni).
   */
  /** Kendi hesabımda web (tarayıcı) girişi doğrulama kodu tercihi. Eski backend 404 → çağıran kartı gizler. */
  getWebTotp: (): Promise<ApiResponse<WebTotpOwnState>> =>
    apiClient
      .get<ApiResponse<WebTotpOwnState>>("/api/auth/web-totp", { suppressErrorToast: true })
      .then((r) => r.data),

  /** Kapatmak parola + (kuruluysa) kod ister; açmak serbest. Hata toast'ı apiClient'tan (4xx backend mesajı). */
  setWebTotp: (body: { optOut: boolean; currentPassword?: string; totpCode?: string }): Promise<ApiResponse<WebTotpOwnState>> =>
    apiClient
      .put<ApiResponse<WebTotpOwnState>>("/api/auth/web-totp", body)
      .then((r) => r.data),

  /** Kendi hatırlanan cihazlarım. Eski backend 404 → çağıran kartı gizler. */
  listTrustedDevices: (): Promise<ApiResponse<TrustedDeviceList>> =>
    apiClient
      .get<ApiResponse<TrustedDeviceList>>("/api/auth/trusted-devices", { suppressErrorToast: true })
      .then((r) => r.data),

  revokeTrustedDevice: (id: string): Promise<void> =>
    apiClient.post(`/api/auth/trusted-devices/${id}/revoke`, {}).then(() => undefined),

  revokeAllTrustedDevices: (): Promise<void> =>
    apiClient.post("/api/auth/trusted-devices/revoke-all", {}).then(() => undefined),

  changePassword: (
    body: ChangePasswordRequest,
    token: string | null,
    config?: AxiosRequestConfig,
  ): Promise<ChangePasswordResponse> =>
    apiClient
      .post<ChangePasswordResponse>("/api/auth/change-password", body, {
        ...config,
        // Çerezli web oturumunda token yok: kısıtlı oturum çerezde, CSRF interceptor'dan.
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      })
      .then((r) => r.data),

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
