import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

/** Kilitli giriş kovası — backend `routes/login-lockout.routes.ts` aynası (VDS denetimi O4). */
export interface LoginLockoutItem {
  /** Kova özeti (SHA-256 hex) — kaldırma ucunun kimliği. */
  id: string;
  /** "IP|kimlik" okunur etiketi; sunucu yeniden başlamadan önceki kovada null. */
  label: string | null;
  method: "PASSWORD" | "PIN" | "CARD" | "OTHER";
  blockedUntil: string;
  penaltyRounds: number;
  /** false: türü belirsiz (sunucu yeniden başladı) — süresi dolunca kendiliğinden açılır. */
  releasable: boolean;
}

export const LOGIN_LOCKOUT_METHOD_LABELS: Record<LoginLockoutItem["method"], string> = {
  PASSWORD: "Parola",
  PIN: "Hızlı PIN",
  CARD: "Personel kartı",
  OTHER: "Bilinmiyor",
};

export const loginLockoutService = {
  list: (): Promise<LoginLockoutItem[]> =>
    apiClient.get<ApiResponse<LoginLockoutItem[]>>("/api/admin/login-lockouts").then((r) => r.data.data ?? []),
  release: (id: string): Promise<LoginLockoutItem> =>
    apiClient
      .post<ApiResponse<LoginLockoutItem>>(`/api/admin/login-lockouts/${id}/release`, {})
      .then((r) => r.data.data as LoginLockoutItem),
};
