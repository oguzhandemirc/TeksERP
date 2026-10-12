import axios from "axios";
import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

/** İki kişilik kimlik sıfırlama onayı — backend `routes/credential-reset.routes.ts` aynası. */
export type CredentialResetKind = "PASSWORD" | "TOTP" | "QUICK_PIN" | "CARD";
export type CredentialResetStatus = "PENDING" | "APPLIED" | "REJECTED" | "CANCELLED";

interface UserRef { id: string; username: string; fullName: string }

export interface CredentialResetRequestItem {
  id: string;
  kind: CredentialResetKind;
  reason: string | null;
  status: CredentialResetStatus;
  createdAt: string;
  decidedAt: string | null;
  expiresAt: string;
  targetUser: UserRef;
  requestedBy: UserRef;
  decidedBy: UserRef | null;
  /** Yalnız listede: süresi dolmuş bekleyen talep. */
  expired?: boolean;
  /** Yalnız listede: izleyen kişi bu talebi onaylayabilir mi (talep eden değil, hedefi kapsıyor). */
  canApprove?: boolean;
}

export const CREDENTIAL_RESET_KIND_LABELS: Record<CredentialResetKind, string> = {
  PASSWORD: "Şifre sıfırlama",
  TOTP: "İki adımlı doğrulama sıfırlama",
  QUICK_PIN: "Hızlı PIN yenileme",
  CARD: "Personel kartı yenileme",
};

/** Doğrudan uç "bu hesap sizden daha yetkili" dediyse (403) yol onay talebidir. */
export function needsApprovalError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const code = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return code === "CREDENTIAL_RESET_NEEDS_APPROVAL";
}

export const credentialResetService = {
  list: (status?: CredentialResetStatus): Promise<CredentialResetRequestItem[]> =>
    apiClient
      .get<ApiResponse<CredentialResetRequestItem[]>>("/api/admin/credential-reset-requests", {
        params: status ? { status } : undefined,
      })
      .then((r) => r.data.data ?? []),

  create: (input: {
    targetUserId: string;
    kind: CredentialResetKind;
    reason?: string | null;
    clientToken: string;
  }): Promise<CredentialResetRequestItem> =>
    apiClient
      .post<ApiResponse<CredentialResetRequestItem>>("/api/admin/credential-reset-requests", input)
      .then((r) => r.data.data as CredentialResetRequestItem),

  approve: (
    id: string,
    payload: { password?: string },
  ): Promise<{ request: CredentialResetRequestItem; result: { pin?: string | null; cardCode?: string } | null }> =>
    apiClient
      .post<ApiResponse<{ request: CredentialResetRequestItem; result: { pin?: string | null; cardCode?: string } | null }>>(
        `/api/admin/credential-reset-requests/${id}/approve`,
        payload,
      )
      .then((r) => r.data.data!),

  reject: (id: string): Promise<CredentialResetRequestItem> =>
    apiClient
      .post<ApiResponse<CredentialResetRequestItem>>(`/api/admin/credential-reset-requests/${id}/reject`, {})
      .then((r) => r.data.data as CredentialResetRequestItem),
};
