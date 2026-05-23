import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type {
  Roll,
  Kk1Context,
  OpenFabricCreateRequest,
  KursunFinishRequest,
} from '../types/models';

export interface InitialEntryRequest {
  itemId: string;
  /** Ham mal genelde NULL — boyahanede kazanır. Opsiyonel renk override. */
  colorId?: string | null;
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

  /**
   * KK1 tabletinde refakat kartı okutulduğunda WO context'i döner. KK1 zaten
   * tamamlanmış veya WO başka adımdaysa backend 400 atar (mevcut konum mesajı
   * dahil) — çağıran try/catch ile yakalayıp banner'da göstermeli.
   */
  getKk1Context: (cardBarcode: string): Promise<ApiResponse<Kk1Context>> =>
    apiClient
      .get<ApiResponse<Kk1Context>>(
        `/rolls/kk1-context/${encodeURIComponent(cardBarcode)}`
      )
      .then((r) => r.data),

  /**
   * Boyahane dönüşü Kurşun/KK2'de yeni açık kumaş Roll oluştur. Barkod basılmaz;
   * colorId/properties receipt'ten inherit edilir.
   */
  createOpenFabric: (data: OpenFabricCreateRequest): Promise<ApiResponse<Roll>> =>
    apiClient.post<ApiResponse<Roll>>('/rolls/open-fabric', data).then((r) => r.data),

  /**
   * Açık kumaş Kurşun/KK2 kapanışı — totalMeters + hata noktaları. Roll Tambur
   * step'ine ilerletilir. Tekrar çağırma 409 atar.
   */
  kursunFinish: (
    rollId: string,
    data: KursunFinishRequest
  ): Promise<ApiResponse<Roll>> =>
    apiClient
      .post<ApiResponse<Roll>>(`/rolls/${rollId}/kursun-finish`, data)
      .then((r) => r.data),
};
