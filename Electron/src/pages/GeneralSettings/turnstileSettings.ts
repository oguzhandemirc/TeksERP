// Tarayıcı girişi bot koruması (Cloudflare Turnstile, V1c) — `GET/PUT /api/admin/turnstile` aynası.
// Gizli anahtar sunucu ortamında (`TURNSTILE_SECRET_KEY`); uç yalnız "tanımlı mı" döner.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface TurnstileAdminView {
  enabled: boolean;
  siteKey: string | null;
  secretConfigured: boolean;
  webPanelMode: boolean;
}

export const TURNSTILE_QUERY_KEY = ["admin", "turnstile"] as const;

export async function getTurnstileSettings(): Promise<TurnstileAdminView> {
  return (await apiClient.get<ApiResponse<TurnstileAdminView>>("/api/admin/turnstile")).data.data;
}

export async function updateTurnstileSettings(body: { enabled: boolean; siteKey: string | null }): Promise<TurnstileAdminView> {
  return (await apiClient.put<ApiResponse<TurnstileAdminView>>("/api/admin/turnstile", body)).data.data;
}
