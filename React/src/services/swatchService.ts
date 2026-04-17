import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Swatch } from "@/types/models";

export interface CreateSwatchRequest {
  sourceRollId: string;
  length: number;
  width?: number | null;
  count: number;
  purpose?: string | null;
  workOrderId?: string | null;
  variantId?: string | null;
}

export const swatchService = {
  create(data: CreateSwatchRequest): Promise<ApiResponse<Swatch[]>> {
    return apiClient
      .post<ApiResponse<Swatch[]>>("/api/tambur/swatch", data)
      .then((r) => r.data);
  },

  list(params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
  }): Promise<ApiResponse<Swatch[]>> {
    const q = new URLSearchParams();
    if (params?.workOrderId) q.set("workOrderId", params.workOrderId);
    if (params?.itemId) q.set("itemId", params.itemId);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<Swatch[]>>(`/api/swatches${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },
};
