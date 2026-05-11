import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface Swatch {
  id: string;
  cardNumber: string;
  barcode: string;
  itemId: string;
  variantId: string | null;
  width: number | null;
  length: number;
  workOrderId: string | null;
  parentRollId: string | null;
  purpose: string | null;
  createdById: string | null;
  item?: { id: string; code: string; name: string } | null;
  variant?: { id: string; code: string; name: string } | null;
  workOrder?: { id: string; batchNumber: string } | null;
  parentRoll?: { id: string; barcode: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SwatchListParams {
  workOrderId?: string;
  itemId?: string;
  limit?: number;
}

export const swatchService = {
  list(params?: SwatchListParams): Promise<ApiResponse<Swatch[]>> {
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
