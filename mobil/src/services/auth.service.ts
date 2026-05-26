import { apiClient } from './api';
import type {
  LoginRequest,
  LoginResponse,
  MobileUsersResponse,
} from '../types/auth';

export const authService = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login', credentials).then((r) => r.data),

  getMobileUsers: (): Promise<MobileUsersResponse> =>
    apiClient.get<MobileUsersResponse>('/auth/mobile-users').then((r) => r.data),
};
