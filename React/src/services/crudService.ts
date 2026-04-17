import apiClient from "./apiClient";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";
import { buildQueryString } from "@/lib/query-builder";

export interface CrudService<T> {
  getAll: (params: QueryParams) => Promise<PaginatedResponse<T>>;
  getById: (id: string) => Promise<ApiResponse<T>>;
  create: (data: Partial<T>) => Promise<ApiResponse<T>>;
  update: (id: string, data: Partial<T>) => Promise<ApiResponse<T>>;
  remove: (id: string) => Promise<ApiResponse<T>>;
  hardRemove: (id: string) => Promise<ApiResponse<T>>;
}

export function createCrudService<T>(basePath: string): CrudService<T> {
  return {
    getAll(params) {
      const qs = buildQueryString(params);
      return apiClient
        .get<PaginatedResponse<T>>(`${basePath}${qs}`)
        .then((r) => r.data);
    },

    getById(id) {
      return apiClient
        .get<ApiResponse<T>>(`${basePath}/${id}`)
        .then((r) => r.data);
    },

    create(data) {
      return apiClient
        .post<ApiResponse<T>>(basePath, data)
        .then((r) => r.data);
    },

    update(id, data) {
      return apiClient
        .patch<ApiResponse<T>>(`${basePath}/${id}`, data)
        .then((r) => r.data);
    },

    remove(id) {
      return apiClient
        .delete<ApiResponse<T>>(`${basePath}/${id}`)
        .then((r) => r.data);
    },

    hardRemove(id) {
      return apiClient
        .delete<ApiResponse<T>>(`${basePath}/${id}/permanent`)
        .then((r) => r.data);
    },
  };
}
