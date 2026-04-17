import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { WorkOrderStep, RollError, StepInfoResponse } from "@/types/models";

export interface StepActionRequest {
  barcode: string;
  stationId: string;
  action: "START" | "FINISH" | "SKIP";
  newQty?: number;
  newWeight?: number;
  reason?: string;
}

export interface ReportErrorRequest {
  rollId: string;
  startMeter: number;
  endMeter: number;
  errorType?: string;
}

export const productionService = {
  getActiveSteps(): Promise<ApiResponse<WorkOrderStep[]>> {
    return apiClient
      .get<ApiResponse<WorkOrderStep[]>>("/api/production/active-steps")
      .then((r) => r.data);
  },

  stepAction(
    data: StepActionRequest,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return apiClient
      .post<ApiResponse<Record<string, unknown>>>(
        "/api/production/step-action",
        data,
      )
      .then((r) => r.data);
  },

  reportError(data: ReportErrorRequest): Promise<ApiResponse<RollError>> {
    return apiClient
      .post<ApiResponse<RollError>>("/api/production/report-error", data)
      .then((r) => r.data);
  },

  getStepInfo(
    barcode: string,
    stationId?: string,
  ): Promise<ApiResponse<StepInfoResponse | null>> {
    const params = new URLSearchParams({ barcode });
    if (stationId) params.set("stationId", stationId);
    return apiClient
      .get<ApiResponse<StepInfoResponse | null>>(
        `/api/production/step-info?${params.toString()}`,
      )
      .then((r) => r.data);
  },
};
