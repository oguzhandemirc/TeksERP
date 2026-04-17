import apiClient from "./apiClient";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";
import type { Roll } from "@/types/models";
import { buildQueryString } from "@/lib/query-builder";

export interface InitialEntryRequest {
  itemId:       string;
  variantId?:    string | null;
  initialQty:   number;
  weightKg?:    number;
  qualityGrade?: string;
  width?:       number;   // En (cm)
}

export const rollService = {
  getAll(params: QueryParams): Promise<PaginatedResponse<Roll>> {
    const qs = buildQueryString(params);
    return apiClient
      .get<PaginatedResponse<Roll>>(`/api/rolls${qs}`)
      .then((r) => r.data);
  },

  getById(id: string): Promise<ApiResponse<Roll>> {
    return apiClient
      .get<ApiResponse<Roll>>(`/api/rolls/${id}`)
      .then((r) => r.data);
  },

  getByBarcode(barcode: string): Promise<ApiResponse<Roll>> {
    return apiClient
      .get<ApiResponse<Roll>>(`/api/rolls/barcode/${barcode}`)
      .then((r) => r.data);
  },

  createInitialEntry(data: InitialEntryRequest): Promise<ApiResponse<Roll>> {
    return apiClient
      .post<ApiResponse<Roll>>("/api/rolls/initial-entry", data)
      .then((r) => r.data);
  },

  softDelete(id: string): Promise<ApiResponse<Roll>> {
    return apiClient
      .delete<ApiResponse<Roll>>(`/api/rolls/${id}`)
      .then((r) => r.data);
  },

  hardDelete(id: string): Promise<ApiResponse<Roll>> {
    return apiClient
      .delete<ApiResponse<Roll>>(`/api/rolls/${id}/permanent`)
      .then((r) => r.data);
  },
};
