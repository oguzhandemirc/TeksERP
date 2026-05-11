import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Permission } from "@/types/permissions";

export interface PermissionTemplate {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  permissions: { permissionId: string; permission: Permission }[];
  createdAt: string;
  updatedAt: string;
}

interface CreateInput {
  name: string;
  description?: string | null;
  permissionIds: string[];
}

interface UpdateInput {
  name?: string;
  description?: string | null;
  permissionIds?: string[];
}

export const permissionTemplateService = {
  list: (): Promise<ApiResponse<PermissionTemplate[]>> =>
    apiClient
      .get<ApiResponse<PermissionTemplate[]>>("/api/admin/permission-templates")
      .then((r) => r.data),

  getById: (id: string): Promise<ApiResponse<PermissionTemplate>> =>
    apiClient
      .get<ApiResponse<PermissionTemplate>>(`/api/admin/permission-templates/${id}`)
      .then((r) => r.data),

  create: (data: CreateInput): Promise<ApiResponse<PermissionTemplate>> =>
    apiClient
      .post<ApiResponse<PermissionTemplate>>("/api/admin/permission-templates", data)
      .then((r) => r.data),

  update: (id: string, data: UpdateInput): Promise<ApiResponse<PermissionTemplate>> =>
    apiClient
      .patch<ApiResponse<PermissionTemplate>>(`/api/admin/permission-templates/${id}`, data)
      .then((r) => r.data),

  remove: (id: string): Promise<void> =>
    apiClient.delete(`/api/admin/permission-templates/${id}`).then(() => undefined),
};
