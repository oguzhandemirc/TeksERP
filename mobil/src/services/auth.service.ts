import { apiClient } from './api';
import type {
  LoginRequest,
  LoginResponse,
  MobileUsersResponse,
} from '../types/auth';

export const authService = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login', credentials).then((r) => r.data),

  /** QR personel kartıyla giriş — yalnız auth.loginMode="card" iken (aksi 403). */
  loginWithCard: (cardCode: string): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login-card', { cardCode }).then((r) => r.data),

  /** Giriş yöntemi (public — login ekranı auth'suz okur): "pin" | "card". Hata → pin. */
  getLoginMode: (): Promise<'pin' | 'card'> =>
    apiClient
      .get<{ success: boolean; data: { mode: 'pin' | 'card' } }>('/auth/login-mode')
      .then((r) => r.data?.data?.mode ?? 'pin')
      .catch(() => 'pin' as const),

  getMobileUsers: (): Promise<MobileUsersResponse> =>
    apiClient.get<MobileUsersResponse>('/auth/mobile-users').then((r) => r.data),
};
