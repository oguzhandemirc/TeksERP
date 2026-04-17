import apiClient from "./apiClient";
import type { LoginRequest, LoginResponse, JwtPayload } from "@/types/auth";
import type { ApiResponse } from "@/types/api";

export const authService = {
  login(credentials: LoginRequest): Promise<LoginResponse> {
    return apiClient
      .post<LoginResponse>("/api/auth/login", credentials)
      .then((res) => res.data);
  },

  getMe(): Promise<ApiResponse<JwtPayload>> {
    return apiClient
      .get<ApiResponse<JwtPayload>>("/api/auth/me")
      .then((res) => res.data);
  },
};
