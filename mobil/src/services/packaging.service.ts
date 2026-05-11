import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Tartı/Paket - operatör API'si
// =============================================================================
// Tartı simülasyonu Faz 1'de mock; Faz 2'de cihazdan Bluetooth/COM ile gerçek.
// finalize: depodaki rulayı tart + paketle → READY_FOR_SHIP'e geçir.
// =============================================================================

export interface PackagingFinalizeInput {
  rollId: string;
  weightKg: number;
  orderLineId?: string | null;
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
  customerName: string | null;
  orderNumber: string | null;
  batchNumber: string;
  printedAt: string;
  customerVariantLabel: string | null;
  customerVariantCode: string | null;
}

export interface PackagingFinalizeResult {
  roll: { id: string; barcode: string; status: string };
  label: PackagingLabelPayload;
}

export const packagingService = {
  simulateWeigh: (rollId: string): Promise<ApiResponse<{ weightKg: number }>> =>
    apiClient
      .post<ApiResponse<{ weightKg: number }>>(`/packaging/simulate-weigh/${rollId}`)
      .then((r) => r.data),

  simulateWeighSwatch: (swatchId: string): Promise<ApiResponse<{ weightKg: number }>> =>
    apiClient
      .post<ApiResponse<{ weightKg: number }>>(
        `/packaging/simulate-weigh-swatch/${swatchId}`
      )
      .then((r) => r.data),

  finalize: (input: PackagingFinalizeInput): Promise<ApiResponse<PackagingFinalizeResult>> =>
    apiClient
      .post<ApiResponse<PackagingFinalizeResult>>(`/packaging/finalize`, input)
      .then((r) => r.data),
};
