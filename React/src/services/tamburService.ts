import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Roll } from "@/types/models";

export interface ErrorDecision {
  errorId: string;
  decision: "CUT" | "NO_CUT";
  qualityGrade?: string;
}

export type CutMode = "BY_DEFECT" | "FIXED_LENGTH";

export interface FinalizeRequest {
  rollId: string;
  netCurrentQty: number;
  decisions: ErrorDecision[];
  foldType?: "2-KAT" | "4-KAT";
  layerCount?: number | null;
  cutMode?: CutMode | null;
  cutLengthM?: number | null;
}

export interface TamburRollSummary {
  rollId: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  width: number | null;
  qualityGrade: string;
  errorCount: number;
  errors: Array<{
    id: string;
    startMeter: number;
    endMeter: number;
    errorType: string | null;
  }>;
}

export interface TamburStepSummary {
  workOrderStepId: string;
  workOrderId: string;
  batchNumber: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  rolls: TamburRollSummary[];
}

export interface SplitAllocationItem {
  orderLineId?: string | null;
  targetStock?: boolean;
  qty: number;
}

export interface SplitAllocateRequest {
  rollId: string;
  allocations: SplitAllocationItem[];
}

export interface FinalizeResponse {
  originalRoll: Roll;
  splitRolls: Roll[];
  processedErrors: number;
}

export interface AllocateRequest {
  rollId: string;
  orderLineId: string;
  allocatedQty: number;
}

export const tamburService = {
  getPendingRolls(): Promise<ApiResponse<Roll[]>> {
    return apiClient
      .get<ApiResponse<Roll[]>>("/api/tambur/pending-rolls")
      .then((r) => r.data);
  },

  getRollForDecision(rollId: string): Promise<ApiResponse<Roll>> {
    return apiClient
      .get<ApiResponse<Roll>>(`/api/tambur/rolls/${rollId}`)
      .then((r) => r.data);
  },

  getByCardBarcode(
    barcode: string,
  ): Promise<ApiResponse<TamburStepSummary>> {
    return apiClient
      .get<ApiResponse<TamburStepSummary>>(
        `/api/tambur/by-card/${encodeURIComponent(barcode)}`,
      )
      .then((r) => r.data);
  },

  finalize(data: FinalizeRequest): Promise<ApiResponse<FinalizeResponse>> {
    return apiClient
      .post<ApiResponse<FinalizeResponse>>("/api/tambur/finalize", data)
      .then((r) => r.data);
  },

  allocate(
    data: AllocateRequest,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return apiClient
      .post<ApiResponse<Record<string, unknown>>>("/api/tambur/allocate", data)
      .then((r) => r.data);
  },

  splitAllocate(
    data: SplitAllocateRequest,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return apiClient
      .post<ApiResponse<Record<string, unknown>>>(
        "/api/tambur/split-allocate",
        data,
      )
      .then((r) => r.data);
  },
};
