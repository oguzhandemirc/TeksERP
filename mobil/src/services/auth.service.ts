import { apiClient } from './api';
import type {
  LoginRequest,
  LoginResponse,
  MobileUsersResponse,
} from '../types/auth';

/** Mobil giriş yöntemleri: list=kullanıcı+şifre, pin=salt hızlı-PIN, card=QR kart. */
export type LoginMethod = 'list' | 'pin' | 'card';
export interface LoginMethodsConfig {
  enabled: LoginMethod[];
  primary: LoginMethod;
}
export const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = { enabled: ['list'], primary: 'list' };

export const authService = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login', credentials).then((r) => r.data),

  /** QR personel kartıyla giriş — yalnız "card" yöntemi etkinken (aksi 403). */
  loginWithCard: (cardCode: string): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login-card', { cardCode }).then((r) => r.data),

  /** SALT hızlı-PIN ile giriş — kullanıcı seçme yok (PIN benzersiz, kimliği belirler). */
  loginWithQuickPin: (pin: string): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login-quick-pin', { pin }).then((r) => r.data),

  /** Giriş yöntemleri (public — login ekranı auth'suz okur). Hata → yalnız liste. */
  getLoginMethods: (): Promise<LoginMethodsConfig> =>
    apiClient
      .get<{ success: boolean; data: LoginMethodsConfig }>('/auth/login-methods')
      .then((r) => {
        const d = r.data?.data;
        if (d && Array.isArray(d.enabled) && d.enabled.length > 0 && d.primary) return d;
        return DEFAULT_LOGIN_METHODS;
      })
      .catch(() => DEFAULT_LOGIN_METHODS),

  getMobileUsers: (): Promise<MobileUsersResponse> =>
    apiClient.get<MobileUsersResponse>('/auth/mobile-users').then((r) => r.data),
};
