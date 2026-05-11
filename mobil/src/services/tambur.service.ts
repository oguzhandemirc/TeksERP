import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type {
  TamburStepSummary,
  TamburOpenCard,
  TamburFinalizeRequest,
  TamburReportErrorRequest,
  TamburSwatchRequest,
  TamburPostSplitRequest,
  Roll,
} from '../types/models';

// Tambur (final + karar) operatör akışı.
// Backend: src/services/tambur.service.ts

export interface TamburDeleteErrorRequest {
  errorId: string;
}

export const tamburService = {
  // Refakat kartı barkodu ile Tambur adımını + açık topları çek
  getByCardBarcode: (barcode: string): Promise<ApiResponse<TamburStepSummary>> =>
    apiClient
      .get<ApiResponse<TamburStepSummary>>(
        `/tambur/by-card/${encodeURIComponent(barcode)}`
      )
      .then((r) => r.data),

  // Adım ID'siyle direkt çek — refresh için
  getStep: (stepId: string): Promise<ApiResponse<TamburStepSummary>> =>
    apiClient
      .get<ApiResponse<TamburStepSummary>>(`/tambur/step/${stepId}`)
      .then((r) => r.data),

  // PROCESS_QC değil; TAMBUR adımlarındaki açık kartlar — kamera modal'ı için
  listOpenCards: (): Promise<ApiResponse<TamburOpenCard[]>> =>
    apiClient
      .get<ApiResponse<TamburOpenCard[]>>('/tambur/open-cards')
      .then((r) => r.data),

  // Hata kararı + roll-split + finalize → top WAREHOUSE'a, parçalar yeni Roll
  finalize: (data: TamburFinalizeRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/tambur/finalize', data)
      .then((r) => r.data),

  // Tambur'da yeni hata kaydı (Kurşun'da yakalanmamış)
  reportError: (data: TamburReportErrorRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/tambur/report-error', data)
      .then((r) => r.data),

  // Tambur karar vermeden hata silme (Kurşun'un deleteError'ıyla aynı yapı)
  deleteError: (data: TamburDeleteErrorRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .delete<ApiResponse<unknown>>('/kursun-qc/error', { data })
      .then((r) => r.data),
  // ↑ Not: backend tarafında ayrı tambur deleteError endpoint'i yok; Kurşun'un
  // delete-error'u doğrudan errorId üzerinden çalışıyor (isProcessed=false ise).
  // Sahada Tambur henüz karar vermediği için aynı endpoint güvenle kullanılabilir.

  // Kartela üretimi — kaynak rolden N adet × L mt parça düşer
  createSwatch: (data: TamburSwatchRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/tambur/swatch', data)
      .then((r) => r.data),

  // Tambur'dan çıkmış son toplar — etiket yeniden basımı için liste
  recentOutputRolls: (params?: {
    workOrderId?: string;
    limit?: number;
  }): Promise<ApiResponse<Roll[]>> => {
    const qs = new URLSearchParams();
    if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiClient
      .get<ApiResponse<Roll[]>>(`/tambur/recent-output-rolls${suffix}`)
      .then((r) => r.data);
  },

  // Post-production split — depodaki topu istenen metrede ikiye böl (aynı kalite)
  postProductionSplit: (
    data: TamburPostSplitRequest
  ): Promise<ApiResponse<{ original: unknown; newRoll: unknown }>> =>
    apiClient
      .post<ApiResponse<{ original: unknown; newRoll: unknown }>>(
        '/tambur/post-production-split',
        data
      )
      .then((r) => r.data),
};
