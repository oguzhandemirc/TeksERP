import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { TravelerCard, TravelerCardScan } from "@/types/models";
import type { ScanType } from "@/types/enums";

export interface ScanRequest {
  barcode: string;
  stationId: string;
  scanType: ScanType;
  notes?: string;
  deviceId?: string;
}

export const travelerCardService = {
  print(workOrderId: string): Promise<ApiResponse<TravelerCard>> {
    return apiClient
      .post<ApiResponse<TravelerCard>>(
        `/api/work-orders/${workOrderId}/traveler-cards`,
      )
      .then((r) => r.data);
  },

  reprint(
    workOrderId: string,
    reason: string,
  ): Promise<ApiResponse<TravelerCard>> {
    return apiClient
      .post<ApiResponse<TravelerCard>>(
        `/api/work-orders/${workOrderId}/traveler-cards/reprint`,
        { reason },
      )
      .then((r) => r.data);
  },

  getHistory(
    workOrderId: string,
  ): Promise<ApiResponse<TravelerCard[]>> {
    return apiClient
      .get<ApiResponse<TravelerCard[]>>(
        `/api/work-orders/${workOrderId}/traveler-cards/history`,
      )
      .then((r) => r.data);
  },

  voidCard(
    cardId: string,
    reason: string,
  ): Promise<ApiResponse<TravelerCard>> {
    return apiClient
      .post<ApiResponse<TravelerCard>>(
        `/api/traveler-cards/${cardId}/void`,
        { reason },
      )
      .then((r) => r.data);
  },

  scan(data: ScanRequest): Promise<ApiResponse<TravelerCardScan>> {
    return apiClient
      .post<ApiResponse<TravelerCardScan>>(
        "/api/traveler-cards/scan",
        data,
      )
      .then((r) => r.data);
  },

  findByBarcode(barcode: string): Promise<ApiResponse<TravelerCard | null>> {
    return apiClient
      .get<ApiResponse<TravelerCard | null>>(
        `/api/traveler-cards/by-barcode/${encodeURIComponent(barcode)}`,
      )
      .then((r) => r.data);
  },
};
