import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { RollStatus } from "@/types/enums";

// Süpervizör manuel düzeltme / kurtarma servisleri (Electron-only, roll:manual-adjust).
// PR-1: "Üretime Geri Al" — ham stokta takılı açık kumaşı Tambur'a geri alma.
// PR-2: Manuel nitelik düzeltme (renk/özellik/en/kalite) + manuel durum düzeltme.

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

/** Manuel nitelik düzeltme payload'u — itemId/barcode KAPSAM DIŞI; sebep zorunlu. */
export interface ManualAttributesPayload {
  colorId?: string | null;
  propertyIds?: string[];
  width?: number | null;
  qualityGrade?: string;
  reason: string;
}

/** Manuel durum düzeltme önizlemesi. */
export interface StatusOverridePreview {
  rollId: string;
  barcode: string | null;
  itemName: string;
  currentStatus: RollStatus;
  allowedTargets: RollStatus[];
  blockReasons: string[];
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

  /** Manuel nitelik düzeltme (renk/özellik/en/kalite) + zorunlu sebep. */
  applyManualAttributes: (
    rollId: string,
    body: ManualAttributesPayload,
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .patch<ApiResponse<unknown>>(`/api/rolls/${rollId}/manual-attributes`, body)
      .then((r) => r.data),

  /** Manuel durum düzeltme önizlemesi (izinli hedefler + engel nedenleri). */
  getStatusOverridePreview: (rollId: string): Promise<ApiResponse<StatusOverridePreview>> =>
    apiClient
      .get<ApiResponse<StatusOverridePreview>>(`/api/rolls/${rollId}/status-override-preview`)
      .then((r) => r.data),

  /** Manuel durum düzeltme (whitelist) + zorunlu sebep. */
  manualStatus: (
    rollId: string,
    body: { targetStatus: RollStatus; reason: string },
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/rolls/${rollId}/manual-status`, body)
      .then((r) => r.data),
};
