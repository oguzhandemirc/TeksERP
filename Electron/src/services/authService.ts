import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { JwtPayload, LoginRequest, LoginResponse } from "@/types/auth";

export const authService = {
  login: (credentials: LoginRequest): Promise<LoginResponse> =>
    apiClient.post<LoginResponse>("/api/auth/login", credentials).then((r) => r.data),

  getMe: (): Promise<ApiResponse<JwtPayload>> =>
    apiClient.get<ApiResponse<JwtPayload>>("/api/auth/me").then((r) => r.data),
};
