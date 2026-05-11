import { apiClient } from './api';
import type { LoginRequest, LoginResponse } from '../types/auth';

export const authService = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>('/auth/login', credentials).then((r) => r.data),
};
