import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { RollStatus } from "@/types/enums";

// Süpervizör manuel düzeltme / kurtarma servisleri (Electron-only, roll:manual-adjust).
// - Manuel nitelik düzeltme (renk/özellik/en/kalite) + zorunlu sebep.
// - "İstasyondan Kurtar" — IN_PRODUCTION takılı topu depoya (WAREHOUSE) alma.

/** Manuel nitelik düzeltme payload'u — itemId/barcode KAPSAM DIŞI; sebep zorunlu. */
export interface ManualAttributesPayload {
  colorId?: string | null;
  propertyIds?: string[];
  width?: number | null;
  qualityGrade?: string;
  reason: string;
}

/** İstasyonda takılı (IN_PRODUCTION) top kurtarma önizlemesi (salt-okunur). */
export interface RescuePreview {
  rollId: string;
  barcode: string | null;
  itemName: string;
  currentStatus: RollStatus;
  eligible: boolean;
  blockReasons: string[];
  stationName: string | null;
  openMovementCount: number;
  willGenerateBarcode: boolean;
}

export const manualAdjustService = {
  /** Manuel nitelik düzeltme (renk/özellik/en/kalite) + zorunlu sebep. */
  applyManualAttributes: (
    rollId: string,
    body: ManualAttributesPayload,
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .patch<ApiResponse<unknown>>(`/api/rolls/${rollId}/manual-attributes`, body)
      .then((r) => r.data),

  /** İstasyonda takılı top kurtarma önizlemesi (eligible + engel nedenleri). */
  getRescuePreview: (rollId: string): Promise<ApiResponse<RescuePreview>> =>
    apiClient
      .get<ApiResponse<RescuePreview>>(`/api/rolls/${rollId}/rescue-preview`)
      .then((r) => r.data),

  /** İstasyonda takılı topu depoya kurtar (zorunlu sebep — audit). */
  rescueStuck: (rollId: string, reason: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/rolls/${rollId}/rescue-stuck`, { reason })
      .then((r) => r.data),
};
