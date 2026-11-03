// K29 okutmayla rota — `/api/scan-route` (istasyon = cihazın çalışma oturumu; sunucu çözer).
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export interface ScanRouteApplyResult {
  kind: 'NOOP' | 'MOVE' | 'INSERT';
  workOrderId: string;
  targetStepId: string;
  insertedStepId: string | null;
  skipped: Array<{ stepId: string; stationName: string }>;
  warnings: string[];
  targetsAdded: string[];
}

export const scanRouteService = {
  apply: (barcode: string, body: { clientToken: string; closeOpenStepId?: string | null }): Promise<ApiResponse<ScanRouteApplyResult>> =>
    apiClient.post<ApiResponse<ScanRouteApplyResult>>(`/scan-route/by-card/${encodeURIComponent(barcode)}`, body).then((r) => r.data),
};
