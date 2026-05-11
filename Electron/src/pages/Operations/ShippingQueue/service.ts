import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ShippingQueueItem, ShippingQueueStatus } from "./types";

interface EnqueueInput {
  orderId: string;
  isUrgent?: boolean;
  note?: string | null;
}

interface ReorderItem {
  id: string;
  priority: number;
}

export const shippingQueueService = {
  list: (
    status?: ShippingQueueStatus | "ALL",
  ): Promise<ApiResponse<ShippingQueueItem[]>> => {
    const qs = status ? `?status=${status}` : "";
    return apiClient
      .get<ApiResponse<ShippingQueueItem[]>>(`/api/shipping-queue${qs}`)
      .then((r) => r.data);
  },

  enqueue: (data: EnqueueInput): Promise<ApiResponse<ShippingQueueItem>> =>
    apiClient
      .post<ApiResponse<ShippingQueueItem>>("/api/shipping-queue", data)
      .then((r) => r.data),

  setUrgent: (
    id: string,
    isUrgent: boolean,
  ): Promise<ApiResponse<ShippingQueueItem>> =>
    apiClient
      .patch<ApiResponse<ShippingQueueItem>>(
        `/api/shipping-queue/${id}/urgent`,
        { isUrgent },
      )
      .then((r) => r.data),

  reorder: (items: ReorderItem[]): Promise<ApiResponse<{ updated: number }>> =>
    apiClient
      .post<ApiResponse<{ updated: number }>>("/api/shipping-queue/reorder", {
        items,
      })
      .then((r) => r.data),

  cancel: (id: string, reason?: string | null): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .delete<ApiResponse<{ id: string }>>(`/api/shipping-queue/${id}`, {
        data: { reason: reason ?? null },
      })
      .then((r) => r.data),

  orphanRolls: (): Promise<ApiResponse<OrphanRoll[]>> =>
    apiClient
      .get<ApiResponse<OrphanRoll[]>>("/api/shipping/orphan-rolls")
      .then((r) => r.data),

  assignOrphanRoll: (
    rollId: string,
    orderLineId: string,
  ): Promise<ApiResponse<{ rollId: string; orderLineId: string }>> =>
    apiClient
      .post<ApiResponse<{ rollId: string; orderLineId: string }>>(
        `/api/shipping/orphan-rolls/${rollId}/assign`,
        { orderLineId },
      )
      .then((r) => r.data),
};

export interface OrphanRollLine {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  requestedQty: number;
  width: number | null;
  variantName: string | null;
  colorName: string | null;
}

export interface OrphanRoll {
  rollId: string;
  barcode: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  packagingDate: string | null;
  plannedOrder: {
    orderId: string;
    orderNumber: string;
    customerName: string;
    deadline: string | null;
    status: string;
    lines: OrphanRollLine[];
  } | null;
}
