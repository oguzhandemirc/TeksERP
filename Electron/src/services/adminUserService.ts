import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { UserPermissionGrant } from "@/types/permissions";

export interface AdminUserListItem {
  id: string;
  username: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  _count: { permissions: number };
}

/** Kullanıcı detayı (Ayak İzi başlığı) — GET /api/admin/users/:id. */
export interface AdminUserDetail extends AdminUserListItem {
  lastSession: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    endReason: string | null;
    device: { id: string; name: string; kind: string };
    machine: { id: string; code: string; name: string } | null;
    station: { id: string; code: string; name: string; kind: string };
  } | null;
}

/** Toplu yetki kaydı öğesi — izin + opsiyonel bitiş tarihi ("YYYY-MM-DD" veya null/sınırsız). */
export interface PermissionSetItem {
  permissionId: string;
  /** Süreli izin bitişi. null/verilmezse süresiz. Backend z.coerce.date() ile Date'e çevirir. */
  validUntil?: string | null;
}

export const adminUserService = {
  list: (): Promise<ApiResponse<AdminUserListItem[]>> =>
    apiClient.get<ApiResponse<AdminUserListItem[]>>("/api/admin/users").then((r) => r.data),

  /** Kullanıcı detayı — kimlik + yetki sayısı + son çalışma oturumu. */
  getById: (id: string): Promise<ApiResponse<AdminUserDetail>> =>
    apiClient.get<ApiResponse<AdminUserDetail>>(`/api/admin/users/${id}`).then((r) => r.data),

  /** Personel kartı sırrını üret/YENİLE (rotasyon) — dönen cardCode QR olarak basılır.
   *  Eski kart anında geçersiz; açık oturumlar etkilenmez. */
  rotateCardToken: (
    userId: string,
  ): Promise<ApiResponse<{ cardCode: string; rotated: boolean }>> =>
    apiClient
      .post<ApiResponse<{ cardCode: string; rotated: boolean }>>(
        `/api/admin/users/${userId}/card-token`,
      )
      .then((r) => r.data),

  /** Kullanıcının mobil kimlik bilgileri (hızlı PIN + QR kart kodu) — panel her
   *  zaman gösterir. GÜVENLİK: düz saklandığından geri okunur (yalnız admin:users). */
  getCredentials: (
    userId: string,
  ): Promise<ApiResponse<{ quickPin: string | null; cardCode: string | null }>> =>
    apiClient
      .get<ApiResponse<{ quickPin: string | null; cardCode: string | null }>>(
        `/api/admin/users/${userId}/credentials`,
      )
      .then((r) => r.data),

  /** Hızlı PIN ata/üret/kaldır (salt-PIN girişi — benzersiz 6 hane). pin verilmezse
   *  rastgele üretilir; başkasında varsa backend 409 döner; clear=true kaldırır. */
  setQuickPin: (
    userId: string,
    input: { pin?: string; clear?: boolean },
  ): Promise<ApiResponse<{ pin: string | null }>> =>
    apiClient
      .post<ApiResponse<{ pin: string | null }>>(`/api/admin/users/${userId}/quick-pin`, input)
      .then((r) => r.data),

  getPermissions: (userId: string): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .get<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/permissions`)
      .then((r) => r.data),

  /** Kullanıcının yetkilerini toplu set'le. Her öğe izin + opsiyonel bitiş tarihi taşır
   *  (süreli izin). Backend { permissions: [{permissionId, validUntil?}] } bekler. */
  setPermissions: (
    userId: string,
    permissions: PermissionSetItem[],
  ): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .put<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/permissions`, {
        permissions,
      })
      .then((r) => r.data),

  resetPassword: (userId: string, password: string): Promise<void> =>
    apiClient.post(`/api/admin/users/${userId}/reset-password`, { password }).then(() => undefined),

  applyTemplate: (
    userId: string,
    templateId: string,
    mode: "merge" | "replace",
  ): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .post<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/apply-template`, {
        templateId,
        mode,
      })
      .then((r) => r.data),
};
