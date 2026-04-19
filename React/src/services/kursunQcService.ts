import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { RollError } from "@/types/models";
import type {
  KursunQcStepSummary,
  RollOperation,
} from "@/types/kursunQc";

export interface RollStepRef {
  rollId: string;
  stepId: string;
  notes?: string | null;
}

export interface ReportErrorRequest {
  rollId: string;
  stepId: string;
  startMeter: number;
  endMeter: number;
  defectTypeId: string;
}

export const kursunQcService = {
  getByCardBarcode(barcode: string): Promise<ApiResponse<KursunQcStepSummary>> {
    return apiClient
      .get<ApiResponse<KursunQcStepSummary>>(
        `/api/kursun-qc/by-card/${encodeURIComponent(barcode)}`,
      )
      .then((r) => r.data);
  },

  getStep(stepId: string): Promise<ApiResponse<KursunQcStepSummary>> {
    return apiClient
      .get<ApiResponse<KursunQcStepSummary>>(`/api/kursun-qc/step/${stepId}`)
      .then((r) => r.data);
  },

  applyKursun(data: RollStepRef): Promise<ApiResponse<RollOperation>> {
    return apiClient
      .post<ApiResponse<RollOperation>>("/api/kursun-qc/apply-kursun", data)
      .then((r) => r.data);
  },

  undoKursun(data: {
    rollId: string;
    stepId: string;
  }): Promise<ApiResponse<{ removed: boolean }>> {
    return apiClient
      .post<ApiResponse<{ removed: boolean }>>(
        "/api/kursun-qc/undo-kursun",
        data,
      )
      .then((r) => r.data);
  },

  completeQc2(data: RollStepRef): Promise<ApiResponse<RollOperation>> {
    return apiClient
      .post<ApiResponse<RollOperation>>("/api/kursun-qc/complete-qc2", data)
      .then((r) => r.data);
  },

  reportError(data: ReportErrorRequest): Promise<ApiResponse<RollError>> {
    return apiClient
      .post<ApiResponse<RollError>>("/api/kursun-qc/report-error", data)
      .then((r) => r.data);
  },

  deleteError(errorId: string): Promise<ApiResponse<{ deleted: true }>> {
    return apiClient
      .delete<ApiResponse<{ deleted: true }>>("/api/kursun-qc/error", {
        data: { errorId },
      })
      .then((r) => r.data);
  },

  finishStep(
    stepId: string,
  ): Promise<ApiResponse<{ movedRollCount: number }>> {
    return apiClient
      .post<ApiResponse<{ movedRollCount: number }>>(
        "/api/kursun-qc/finish-step",
        { stepId },
      )
      .then((r) => r.data);
  },
};
