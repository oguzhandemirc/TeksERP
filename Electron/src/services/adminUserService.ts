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

export const adminUserService = {
  list: (): Promise<ApiResponse<AdminUserListItem[]>> =>
    apiClient.get<ApiResponse<AdminUserListItem[]>>("/api/admin/users").then((r) => r.data),

  getPermissions: (userId: string): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .get<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/permissions`)
      .then((r) => r.data),

  setPermissions: (
    userId: string,
    permissionIds: string[],
  ): Promise<ApiResponse<UserPermissionGrant[]>> =>
    apiClient
      .put<ApiResponse<UserPermissionGrant[]>>(`/api/admin/users/${userId}/permissions`, {
        permissionIds,
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
