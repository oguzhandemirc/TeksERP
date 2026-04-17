import apiClient from "./apiClient";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";
import type { Item } from "@/types/models";
import { buildQueryString } from "@/lib/query-builder";

export interface ItemVariant {
  id: string;
  code: string;
  name: string;
}

const baseUrl = "/api/items";

// CRUD operations
export const itemService = {
  getAll: (params: QueryParams) => {
    const qs = buildQueryString(params);
    return apiClient.get<PaginatedResponse<Item>>(`${baseUrl}${qs}`).then((r) => r.data);
  },

  getById: (id: string) => {
    return apiClient.get<ApiResponse<Item>>(`${baseUrl}/${id}`).then((r) => r.data);
  },

  create: (data: Partial<Item>) => {
    return apiClient.post<ApiResponse<Item>>(baseUrl, data).then((r) => r.data);
  },

  update: (id: string, data: Partial<Item>) => {
    return apiClient.patch<ApiResponse<Item>>(`${baseUrl}/${id}`, data).then((r) => r.data);
  },

  remove: (id: string) => {
    return apiClient.delete<ApiResponse<Item>>(`${baseUrl}/${id}`).then((r) => r.data);
  },

  hardRemove: (id: string) => {
    return apiClient.delete<ApiResponse<Item>>(`${baseUrl}/${id}/permanent`).then((r) => r.data);
  },

  // Get variants for an item
  getVariants: (itemId: string) => {
    return apiClient.get<ApiResponse<ItemVariant[]>>(`${baseUrl}/${itemId}/variants`).then((r) => r.data);
  },

  // Create a variant for an item
  createVariant: (itemId: string, data: { code: string; name: string }) => {
    return apiClient.post<ApiResponse<ItemVariant>>(`${baseUrl}/${itemId}/variants`, data).then((r) => r.data);
  },

  // Delete a variant
  deleteVariant: (itemId: string, variantId: string) => {
    return apiClient.delete<ApiResponse<ItemVariant>>(`${baseUrl}/${itemId}/variants/${variantId}`).then((r) => r.data);
  },
};
