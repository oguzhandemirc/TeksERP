import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Permission } from "@/types/permissions";

export const permissionCatalogService = {
  list: (): Promise<ApiResponse<Permission[]>> =>
    apiClient.get<ApiResponse<Permission[]>>("/api/admin/permissions").then((r) => r.data),
};
