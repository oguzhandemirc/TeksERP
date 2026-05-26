import apiClient from "./apiClient";
import type {
  ApiResponse,
  CursorPaginatedResponse,
  CursorParams,
  PaginatedResponse,
  QueryParams,
} from "@/types/api";
import { buildCursorQueryString, buildQueryString } from "@/lib/query-builder";

export interface CrudService<T> {
  /** Offset listing — küçük dropdown/lookup için. */
  getAll: (params: QueryParams) => Promise<PaginatedResponse<T>>;
  /** Cursor listing — DataTable sayfalarında default. */
  listCursor: (params: CursorParams) => Promise<CursorPaginatedResponse<T>>;
  getById: (id: string) => Promise<ApiResponse<T>>;
  create: (data: Partial<T>) => Promise<ApiResponse<T>>;
  update: (id: string, data: Partial<T>) => Promise<ApiResponse<T>>;
  remove: (id: string) => Promise<ApiResponse<T>>;
  hardRemove: (id: string) => Promise<ApiResponse<T>>;
  restore: (id: string) => Promise<ApiResponse<T>>;
}

export function createCrudService<T>(basePath: string): CrudService<T> {
  return {
    getAll: (params) =>
      apiClient.get<PaginatedResponse<T>>(`${basePath}${buildQueryString(params)}`).then((r) => r.data),
    listCursor: (params) =>
      apiClient
        .get<CursorPaginatedResponse<T>>(`${basePath}${buildCursorQueryString(params)}`)
        .then((r) => r.data),
    getById: (id) => apiClient.get<ApiResponse<T>>(`${basePath}/${id}`).then((r) => r.data),
    create: (data) => apiClient.post<ApiResponse<T>>(basePath, data).then((r) => r.data),
    update: (id, data) => apiClient.patch<ApiResponse<T>>(`${basePath}/${id}`, data).then((r) => r.data),
    remove: (id) => apiClient.delete<ApiResponse<T>>(`${basePath}/${id}`).then((r) => r.data),
    hardRemove: (id) => apiClient.delete<ApiResponse<T>>(`${basePath}/${id}/permanent`).then((r) => r.data),
    restore: (id) =>
      apiClient
        .patch<ApiResponse<T>>(`${basePath}/${id}`, { isActive: true })
        .then((r) => r.data),
  };
}
