import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Roll } from '../types/models';

export interface InitialEntryRequest {
  itemId: string;
  variantId?: string | null;
  initialQty: number;
  weightKg?: number;
  qualityGrade?: string;
  width?: number;
  /** Refakat kartı ile WO seçildiyse: top doğrudan WO ilk step'ine bağlanır. */
  workOrderId?: string | null;
}

export const rollService = {
  createInitialEntry: (data: InitialEntryRequest): Promise<ApiResponse<Roll>> =>
    apiClient.post<ApiResponse<Roll>>('/rolls/initial-entry', data).then((r) => r.data),

  getByBarcode: (barcode: string): Promise<ApiResponse<Roll>> =>
    apiClient.get<ApiResponse<Roll>>(`/rolls/barcode/${barcode}`).then((r) => r.data),

  /** Soft delete — top SCRAP olarak işaretlenir. Açık movement'lar kapatılır,
   *  currentStep temizlenir. SHIPPED / AT_SUBCONTRACTOR / açık sevki olan toplar reddedilir. */
  scrap: (id: string): Promise<ApiResponse<Roll>> =>
    apiClient.delete<ApiResponse<Roll>>(`/rolls/${id}`).then((r) => r.data),

  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Roll>> =>
    apiClient.get<PaginatedResponse<Roll>>(`/rolls${buildQueryString(params)}`).then((r) => r.data),

  getHistory: (
    rollId: string
  ): Promise<
    ApiResponse<{
      events: Array<{
        kind: string;
        title: string;
        at: string;
        stationName: string | null;
        operatorName: string | null;
        details?: Record<string, unknown>;
      }>;
    }>
  > =>
    apiClient
      .get<
        ApiResponse<{
          events: Array<{
            kind: string;
            title: string;
            at: string;
            stationName: string | null;
            operatorName: string | null;
            details?: Record<string, unknown>;
          }>;
        }>
      >(`/rolls/${rollId}/history`)
      .then((r) => r.data),
};
