// K29 okutmayla rota — `/api/scan-route` (istasyon = cihazın çalışma oturumu; sunucu çözer).
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export interface ScanRouteApplyResult {
  kind: 'NOOP' | 'MOVE' | 'INSERT';
  workOrderId: string;
  targetStepId: string;
  insertedStepId: string | null;
  skipped: { stepId: string; stationName: string }[];
  warnings: string[];
  targetsAdded: string[];
}

/** GET önizleme. `canClose` (S15b): "bitmiş say ve geç" yetkisi; eski sunucu göndermez (undefined = bugünkü davranış). */
export interface ScanRoutePreview {
  enabled: boolean;
  view: unknown;
  canClose?: boolean;
}

export const scanRouteService = {
  preview: (barcode: string): Promise<ApiResponse<ScanRoutePreview>> =>
    apiClient.get<ApiResponse<ScanRoutePreview>>(`/scan-route/by-card/${encodeURIComponent(barcode)}`).then((r) => r.data),
  apply: (barcode: string, body: { clientToken: string; closeOpenStepId?: string | null }): Promise<ApiResponse<ScanRouteApplyResult>> =>
    apiClient.post<ApiResponse<ScanRouteApplyResult>>(`/scan-route/by-card/${encodeURIComponent(barcode)}`, body).then((r) => r.data),
};
