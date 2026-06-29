import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

// Süpervizör manuel düzeltme / kurtarma servisleri (Electron-only, roll:manual-adjust).
// PR-1: "Üretime Geri Al" — ham stokta takılı açık kumaşı Tambur'a geri alma.

export interface RecoveryTarget {
  workOrderId: string;
  batchNumber: string;
  workOrderStatus: string;
  stepId: string;
  stationName: string;
  stepStatus: string;
}

export interface RecoveryTargetsResult {
  roll: {
    id: string;
    itemId: string;
    itemName: string;
    currentQty: number;
    qualityGrade: string;
  };
  /** Top "üretime geri al" için uygun bir takılı orphan mı? */
  eligible: boolean;
  /** eligible=false ise neden. */
  reason?: string;
  eligibleTargets: RecoveryTarget[];
  /** Bilgilendirme (örn. uygun açık iş emri yok). */
  warnings: string[];
}

export const manualAdjustService = {
  /** Takılı açık kumaş için uygun (aynı ürünlü, açık, Tambur'lu) iş emri adımları. */
  getRecoveryTargets: (rollId: string): Promise<ApiResponse<RecoveryTargetsResult>> =>
    apiClient
      .get<ApiResponse<RecoveryTargetsResult>>(`/api/rolls/${rollId}/recovery-targets`)
      .then((r) => r.data),

  /** Takılı açık kumaşı seçilen Tambur adımına geri al (zorunlu sebep — audit). */
  recoverToProduction: (
    rollId: string,
    body: { stepId: string; reason: string },
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/rolls/${rollId}/recover-to-production`, body)
      .then((r) => r.data),
};
