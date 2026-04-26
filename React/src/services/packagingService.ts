import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Roll } from "@/types/models";

export type PackagingDestination = "SHIP" | "WAREHOUSE";

export interface PackagingOrderLinkOption {
  orderLineId: string;
  orderNumber: string;
  customerName: string;
  itemCode: string;
  itemName: string;
  requestedQty: number;
}

export interface PackagingRollSummary {
  rollId: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  width: number | null;
  weightKg: number | null;
  qualityGrade: string;
  workOrderId: string;
  workOrderBatchNumber: string;
  stepId: string;
  defaultOrderLineId: string | null;
  defaultCustomerName: string | null;
  availableOrderLinks: PackagingOrderLinkOption[];
  ownerCustomerId: string | null;
  ownerCustomerName: string | null;
  previewCustomerName: string | null;
  previewCustomerLabel: string | null;
  previewCustomerCode: string | null;
}

export interface PackagingStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: PackagingRollSummary[];
}

export interface PackagingLabelPayload {
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number;
  destination: PackagingDestination;
  customerName: string | null;
  orderNumber: string | null;
  batchNumber: string;
  printedAt: string;
  customerVariantLabel: string | null;
  customerVariantCode: string | null;
}

export interface PackagingFinalizeRequest {
  rollId: string;
  weightKg: number;
  destination: PackagingDestination;
  orderLineId?: string | null;
}

export interface PackagingFinalizeResponse {
  roll: Roll;
  label: PackagingLabelPayload;
}

export const packagingService = {
  getPendingRolls(): Promise<ApiResponse<PackagingRollSummary[]>> {
    return apiClient
      .get<ApiResponse<PackagingRollSummary[]>>(
        "/api/packaging/pending-rolls",
      )
      .then((r) => r.data);
  },

  getByCardBarcode(
    barcode: string,
  ): Promise<ApiResponse<PackagingStepSummary>> {
    return apiClient
      .get<ApiResponse<PackagingStepSummary>>(
        `/api/packaging/by-card/${encodeURIComponent(barcode)}`,
      )
      .then((r) => r.data);
  },

  getByRollBarcode(
    barcode: string,
  ): Promise<ApiResponse<PackagingRollSummary>> {
    return apiClient
      .get<ApiResponse<PackagingRollSummary>>(
        `/api/packaging/by-roll/${encodeURIComponent(barcode)}`,
      )
      .then((r) => r.data);
  },

  simulateWeigh(rollId: string): Promise<ApiResponse<{ weightKg: number }>> {
    return apiClient
      .post<ApiResponse<{ weightKg: number }>>(
        `/api/packaging/simulate-weigh/${rollId}`,
      )
      .then((r) => r.data);
  },

  finalize(
    data: PackagingFinalizeRequest,
  ): Promise<ApiResponse<PackagingFinalizeResponse>> {
    return apiClient
      .post<ApiResponse<PackagingFinalizeResponse>>(
        "/api/packaging/finalize",
        data,
      )
      .then((r) => r.data);
  },
};
