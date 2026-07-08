import { apiClient } from './api';
import { BOOTSTRAP_TIMEOUT_MS } from '../constants/api';
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
  /** Firma adı — public login-methods ucundan (company.name ayarı). Login/kilit
   *  başlığında marka satırı olarak gösterilir. */
  companyName?: string;
}
export const DEFAULT_LOGIN_METHODS: LoginMethodsConfig = {
  enabled: ['list'],
  primary: 'list',
  companyName: 'Adnan Şahin Tekstil',
};

export const authService = {
  /** clientType='mobile' HER giriş gövdesine eklenir (backend same-type policy).
   *  confirmKick opsiyonel — 'notify' çakışmasını onaylayınca true ile tekrarlanır. */
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiClient
      .post<LoginResponse>('/auth/login', { clientType: 'mobile', ...credentials })
      .then((r) => r.data),

  /** QR personel kartıyla giriş — yalnız "card" yöntemi etkinken (aksi 403). */
  loginWithCard: (cardCode: string, confirmKick?: boolean): Promise<LoginResponse> =>
    apiClient
      .post<LoginResponse>('/auth/login-card', { cardCode, clientType: 'mobile', confirmKick })
      .then((r) => r.data),

  /** SALT hızlı-PIN ile giriş — kullanıcı seçme yok (PIN benzersiz, kimliği belirler). */
  loginWithQuickPin: (pin: string, confirmKick?: boolean): Promise<LoginResponse> =>
    apiClient
      .post<LoginResponse>('/auth/login-quick-pin', { pin, clientType: 'mobile', confirmKick })
      .then((r) => r.data),

  /** Giriş yöntemleri (public — login ekranı auth'suz okur). Kısa timeout:
   *  ekranı bekleten bootstrap isteği (cache'ten çizim + arka plan tazeleme).
   *  Ağ hatasında ARTIK default'a düşmez, hata FIRLATIR: query hatada son
   *  bilinen veriyi korur (SWR) — eski catch, başarısız arka plan yoklamasında
   *  kart/PIN konfigürasyonunu sessizce 'yalnız liste'ye eziyordu. Bozuk-ama-
   *  başarılı cevapta default korunur (şekil doğrulaması). */
  getLoginMethods: (): Promise<LoginMethodsConfig> =>
    apiClient
      .get<{ success: boolean; data: LoginMethodsConfig }>('/auth/login-methods', {
        timeout: BOOTSTRAP_TIMEOUT_MS,
      })
      .then((r) => {
        const d = r.data?.data;
        if (d && Array.isArray(d.enabled) && d.enabled.length > 0 && d.primary) return d;
        return DEFAULT_LOGIN_METHODS;
      }),

  getMobileUsers: (): Promise<MobileUsersResponse> =>
    apiClient
      .get<MobileUsersResponse>('/auth/mobile-users', { timeout: BOOTSTRAP_TIMEOUT_MS })
      .then((r) => r.data),
};
