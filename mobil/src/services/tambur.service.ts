import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { RollCursorPage } from './roll.service';
import type {
  TamburStepSummary,
  TamburOpenCard,
  TamburFinalizeRequest,
  TamburReportErrorRequest,
  TamburContext,
  TamburCutRequest,
  TamburFinalizeOpenFabricRequest,
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

  // NOT: createSwatch kaldırıldı — kartela artık Tambur'da kesilmiyor, fason
  // dönüşünden doğuyor (kartelaService). Bkz. KARTELA-TASARIM.md.

  // Tambur'dan çıkmış son toplar — etiket yeniden basımı için liste
  // Cursor-paginated + aramalı. Modal infinite scroll için (RollCursorPage).
  recentOutputRolls: (params?: {
    workOrderId?: string;
    limit?: number;
    cursor?: string | null;
    search?: string;
    withTotal?: boolean;
  }): Promise<RollCursorPage> => {
    const qs = new URLSearchParams();
    qs.set('mode', 'cursor');
    if (params?.workOrderId) qs.set('workOrderId', params.workOrderId);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.search) qs.set('search', params.search);
    if (params?.withTotal) qs.set('withTotal', 'true');
    return apiClient
      .get<RollCursorPage>(`/tambur/recent-output-rolls?${qs.toString()}`)
      .then((r) => r.data);
  },

  /**
   * Yeni açık kumaş modeli — boyahane dönüşü. WO + sipariş progress + LIFO açık
   * kumaş listesini tek atışta döner. Kart pasif veya WO Tambur'da değilse 400.
   */
  getContext: (cardBarcode: string): Promise<ApiResponse<TamburContext>> =>
    apiClient
      .get<ApiResponse<TamburContext>>(
        `/tambur/context/${encodeURIComponent(cardBarcode)}`
      )
      .then((r) => r.data),

  /**
   * Açık kumaşta tek kesim — child Roll (barkodlu) oluşur, parent açık kumaşın
   * currentQty'i kalan metreye düşer. Status WAREHOUSE/SCRAP/A1_STOCK.
   */
  cutOpenFabric: (
    rollId: string,
    data: TamburCutRequest
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/tambur/${rollId}/cut`, data)
      .then((r) => r.data),

  /**
   * Açık kumaşı bitir — parent Roll TAMBUR_CONSUMED'a çekilir. scrapRemaining=
   * true ise kalan metre fire child Roll olarak kaydedilir. foldType/layerCount
   * verilmezse WO planlanan değerleri kullanılır.
   */
  finalizeOpenFabric: (
    rollId: string,
    data: TamburFinalizeOpenFabricRequest
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/tambur/${rollId}/finalize-open-fabric`, data)
      .then((r) => r.data),

  /**
   * Top Kesme — depo (WAREHOUSE) topundan çoklu kesim. Her çağrı child Roll
   * doğurur, parent.currentQty düşer (parent yaşamaya devam eder). Parent
   * özellikleri ve KURSUN/QC2 operasyonları child'a inherit edilir.
   */
  cutWarehouseRoll: (
    rollId: string,
    data: { cutLength: number; qualityGrade?: string | null; notes?: string | null; targetOrderLineId?: string | null; markedForKartela?: boolean }
  ): Promise<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>> =>
    apiClient
      .post<ApiResponse<{ childRoll: Roll; parentRoll: Roll; parentRemainingQty: number }>>(
        `/tambur/${rollId}/cut-warehouse`,
        data
      )
      .then((r) => r.data),

  /**
   * Top Kesme bitir — parent TAMBUR_CONSUMED'a (arşiv) çekilir; kalan kumaş için
   * remainingAction'a göre 1.KALITE/A1/FIRE child Roll oluşur veya discard.
   */
  finalizeWarehouseCut: (
    rollId: string,
    data: {
      remainingAction?: 'keep_1kalite' | 'keep_a1' | 'scrap' | 'discard';
      notes?: string | null;
    }
  ): Promise<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>> =>
    apiClient
      .post<ApiResponse<{ rollId: string; remainingChild: Roll | null; remainingQty: number }>>(
        `/tambur/${rollId}/finalize-warehouse-cut`,
        data
      )
      .then((r) => r.data),
};
