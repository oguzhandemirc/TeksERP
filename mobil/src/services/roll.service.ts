import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type {
  Roll,
  OpenFabricCreateRequest,
  KursunFinishRequest,
} from '../types/models';

export interface RollStats {
  totalCount: number;
  /** Filtreye uyan tüm rolların `currentQty` toplamı — metre. */
  totalQty: number;
  /** `weightKg` toplamı (null'lar atlanır) — kg. */
  totalWeight: number;
  /** RollStatus → adet. Eşleşmeyen status hiç yer almaz. */
  byStatus: Record<string, number>;
  /** Kalite kodu → adet (A1, FIRE, 1.KALITE …). */
  byQuality: Record<string, number>;
}

/** Backend `GET /rolls/:id/cancel-preview` cevabı (inventory.service ile aynı). */
export interface RollCancelPreview {
  rollId: string;
  barcode: string | null;
  status: string;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  /** Hard-block yoksa true. */
  canCancel: boolean;
  /** canCancel=false ise neden (Türkçe). */
  blockReason: string | null;
  /** İstasyonda/iş emrinde aktif → iptal için confirmActive şart. */
  requiresConfirm: boolean;
  activeAt: {
    stepId: string;
    stationName: string | null;
    stationKind: string | null;
    workOrderId: string;
    batchNumber: string | null;
  } | null;
  openMovementCount: number;
}

export interface RollCursorPage {
  success: boolean;
  data: Roll[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface CursorListParams {
  limit?: number;
  cursor?: string | null;
  search?: string;
  filters?: Record<string, string | string[]>;
  /** Backend `?withTotal=true` — ilk sayfada total döndürmek için. */
  withTotal?: boolean;
}

function buildCursorQueryString(params: CursorListParams): string {
  const sp = new URLSearchParams();
  sp.set('mode', 'cursor');
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.cursor) sp.set('cursor', params.cursor);
  if (params.search) sp.set('search', params.search);
  if (params.withTotal) sp.set('withTotal', 'true');
  if (params.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (!v || (Array.isArray(v) && v.length === 0)) continue;
      const val = Array.isArray(v) ? v.join(',') : v;
      if (val) sp.set(`filter[${k}]`, val);
    }
  }
  return `?${sp.toString()}`;
}

export interface InitialEntryRequest {
  itemId: string;
  /** Ham mal genelde NULL — boyahanede kazanır. Opsiyonel renk override. */
  colorId?: string | null;
  initialQty: number;
  weightKg?: number;
  qualityGrade?: string;
  width?: number;
  /**
   * Opsiyonel idempotency anahtarı (UUID) — offline KK1 / ağ-retry için. Barkod
   * artık SUNUCU'da sıralı atanır (TEKS+YYMMDD+H/F+A001..); aynı token'la 2. çağrı
   * cached Roll döner (mükerrer top önlenir). Etiket sunucudan dönen barkodla basılır.
   */
  clientToken?: string;
}

export const rollService = {
  createInitialEntry: (data: InitialEntryRequest): Promise<ApiResponse<Roll>> =>
    apiClient.post<ApiResponse<Roll>>('/rolls/initial-entry', data).then((r) => r.data),

  getByBarcode: (barcode: string): Promise<ApiResponse<Roll>> =>
    apiClient.get<ApiResponse<Roll>>(`/rolls/barcode/${barcode}`).then((r) => r.data),

  /**
   * Soft delete — top CANCELLED işaretlenir. Açık movement'lar kapatılır,
   * currentStep temizlenir. SHIPPED / AT_SUBCONTRACTOR / açık sevki olan toplar
   * reddedilir. Bir istasyonda/iş emrinde AKTİF top (currentStep/açık movement)
   * için backend `confirmActive=true` ŞART — önce getCancelPreview ile operatöre
   * gösterilir, onaylanırsa confirmActive geçilir.
   */
  scrap: (id: string, confirmActive = false): Promise<ApiResponse<Roll>> =>
    apiClient
      .delete<ApiResponse<Roll>>(
        `/rolls/${id}${confirmActive ? '?confirmActive=true' : ''}`,
      )
      .then((r) => r.data),

  /** İptal önizlemesi — silmeden önce somut etki (hangi istasyon/iş emri). */
  getCancelPreview: (id: string): Promise<ApiResponse<RollCancelPreview>> =>
    apiClient
      .get<ApiResponse<RollCancelPreview>>(`/rolls/${id}/cancel-preview`)
      .then((r) => r.data),

  /**
   * Saha #4: top etiketini değiştir (renk/özellik/en/kalite). Yalnız serbest
   * stok/depo veya PREPARING sevkiyattaki top; commit'li sevkiyatta 409.
   */
  relabel: (
    id: string,
    data: { colorId?: string | null; propertyIds?: string[]; width?: number | null; qualityGrade?: string },
  ): Promise<ApiResponse<unknown>> =>
    apiClient.patch<ApiResponse<unknown>>(`/rolls/${id}/label`, data).then((r) => r.data),

  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Roll>> =>
    apiClient.get<PaginatedResponse<Roll>>(`/rolls${buildQueryString(params)}`).then((r) => r.data),

  /** Cursor-pagination liste — infinite scroll için. */
  getAllCursor: (params: CursorListParams): Promise<RollCursorPage> =>
    apiClient.get<RollCursorPage>(`/rolls${buildCursorQueryString(params)}`).then((r) => r.data),

  /**
   * Liste ile aynı filtre setini paylaşan TÜM-DB özeti.
   * Sayfa toplamı değil; gerçek aggregate.
   */
  getStats: (params: {
    search?: string;
    filters?: Record<string, string | string[]>;
  }): Promise<ApiResponse<RollStats>> => {
    const sp = new URLSearchParams();
    if (params.search) sp.set('search', params.search);
    if (params.filters) {
      for (const [k, v] of Object.entries(params.filters)) {
        if (!v || (Array.isArray(v) && v.length === 0)) continue;
        const val = Array.isArray(v) ? v.join(',') : v;
        if (val) sp.set(`filter[${k}]`, val);
      }
    }
    const qs = sp.toString();
    return apiClient
      .get<ApiResponse<RollStats>>(`/rolls/stats${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  // Depo kapsam sayaçları (çuval havuzu modeli) — serbest (sackId=null) / çuval depo
  // havuzu (pool: sackId dolu, sevkiyatsız) / planlı sevkiyat (PLANNED).
  getWarehouseScope: (): Promise<
    ApiResponse<{
      free: { count: number; qty: number };
      pool: { count: number; qty: number };
      planned: { count: number; qty: number };
    }>
  > => apiClient.get(`/rolls/warehouse-scope`).then((r) => r.data),

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
