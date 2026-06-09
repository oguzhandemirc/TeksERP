import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Roll, WorkOrder } from '../types/models';

/** WO oluşturma/replace için rota adımı. Replace'te mevcut adımı güncellemek için `id` ver. */
export interface WorkOrderStepInput {
  id?: string;
  stationId: string;
  notes?: string | null;
  requiredCategoryId?: string | null;
  plannedSubcontractorId?: string | null;
}

/** WO oluşturma/replace ortak gövde — quick-start ve düzenleme paylaşır. */
export interface WorkOrderPayload {
  batchNumber?: string | null;
  type?: 'ORDER_PRODUCTION' | 'STOCK_PRODUCTION';
  width?: number | null;
  targetQuantity?: number | null;
  targetWeight?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  routeTemplateId?: string | null;
  targetItemId?: string | null;
  targetColorId?: string | null;
  foldType?: string | null;
  dyehouseNote?: string | null;
  steps?: WorkOrderStepInput[];
  /**
   * routeTemplateId ile birlikte: şablondan klonlanan adımların not/fason planlamasını
   * `sequence`'e göre override eder (Hızlı İş Emri Gelişmiş modda istasyon notları).
   */
  stepPlanning?: {
    sequence: number;
    notes?: string | null;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
  }[];
  orderLineIds?: string[];
  targetPropertyIds?: string[];
}

/** PATCH /work-orders/:id — temel alan güncelleme (rota/sipariş hariç). */
export interface WorkOrderUpdatePayload {
  batchNumber?: string;
  width?: number | null;
  targetQuantity?: number | null;
  targetWeight?: number | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  targetItemId?: string | null;
  targetColorId?: string | null;
  foldType?: string | null;
  dyehouseNote?: string | null;
}

/** POST /work-orders/quick-start gövdesi. */
export interface QuickStartRequest extends WorkOrderPayload {
  rollBarcodes: string[];
}

export interface QuickStartResult {
  workOrder: WorkOrder;
  attached: number;
  errors: string[];
}

/** GET /work-orders/:id/cancel-impact cevabı (iptal önizleme). */
export interface WorkOrderCancelImpact {
  workOrderId: string;
  batchNumber: string;
  status: string;
  canCancel: boolean;
  blockReason: string | null;
  rolls: {
    id: string;
    barcode: string | null;
    status: string;
    currentQty: number;
    colorName: string | null;
    colorHex: string | null;
    propertyCount: number;
    processed: boolean;
    atSubcontractor: boolean;
  }[];
  travelerCardCount: number;
  atSubcontractorCount: number;
  processedCount: number;
}

/** GET /work-orders/:id/travel-card cevabı (refakat/iş emri kartı verisi). */
export interface WorkOrderTravelCard {
  batchNumber: string;
  type: string;
  width: number | null;
  targetColor: { id: string; code: string; name: string } | null;
  status: string;
  route: {
    sequence: number;
    stationCode: string | null;
    stationName: string;
    stationType: string;
    status: string;
  }[];
  linkedOrders: {
    orderNumber: string;
    customerName: string;
    itemName: string;
    colorName: string | null;
    requestedQty: number;
  }[];
  createdAt: string;
}

/** Cursor (keyset) sayfa cevabı — WO listesi infinite scroll için. */
export interface WorkOrderCursorPage {
  success: boolean;
  data: WorkOrder[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface WorkOrderCursorParams {
  limit?: number;
  cursor?: string | null;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  filters?: Record<string, string | string[]>;
  withTotal?: boolean;
}

export const workOrderService = {
  // withOrderDetail=true → orderLinks (customer + ürün), targetColor, dispatchedTotalQty
  // alanları zenginleştirilir. Fason Sevk picker'ı için kullanılır.
  // excludeWithOpenDispatch=true → adımlarından birinde halen iptal edilmemiş ve
  // mal kabulü tam yapılmamış bir sevki olan WO'ları liste-dışı bırakır
  // (operatör önce eski sevki iptal etmek zorunda).
  getAll: (
    params: Partial<QueryParams>,
    options?: { withOrderDetail?: boolean; excludeWithOpenDispatch?: boolean }
  ): Promise<PaginatedResponse<WorkOrder>> => {
    const qs = buildQueryString(params);
    const extras: string[] = [];
    if (options?.withOrderDetail) extras.push('withOrderDetail=true');
    if (options?.excludeWithOpenDispatch) extras.push('excludeWithOpenDispatch=true');
    const sep = qs ? '&' : '?';
    const extra = extras.length ? sep + extras.join('&') : '';
    return apiClient
      .get<PaginatedResponse<WorkOrder>>(`/work-orders${qs}${extra}`)
      .then((r) => r.data);
  },

  /**
   * Cursor-mode WO listesi — infinite scroll. `mode=cursor` keyset sayfalama
   * (offset/derin-sayfa yok). `hasOpenExternalStep=true` → yalnız fason adımı
   * sevke açık WO'lar (Fason Sevk picker'ı). `withOrderDetail=true` → satır
   * için tarih/termin/ürün/hedef.
   */
  getAllCursor: (
    params: WorkOrderCursorParams,
    options?: { withOrderDetail?: boolean; hasOpenExternalStep?: boolean },
  ): Promise<WorkOrderCursorPage> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.search) sp.set('search', params.search);
    if (params.sortBy) sp.set('sortBy', params.sortBy);
    if (params.sortOrder) sp.set('sortOrder', params.sortOrder);
    if (params.withTotal) sp.set('withTotal', 'true');
    if (params.filters) {
      for (const [k, v] of Object.entries(params.filters)) {
        if (!v || (Array.isArray(v) && v.length === 0)) continue;
        const val = Array.isArray(v) ? v.join(',') : v;
        if (val) sp.set(`filter[${k}]`, val);
      }
    }
    if (options?.withOrderDetail) sp.set('withOrderDetail', 'true');
    if (options?.hasOpenExternalStep) sp.set('hasOpenExternalStep', 'true');
    return apiClient
      .get<WorkOrderCursorPage>(`/work-orders?${sp.toString()}`)
      .then((r) => r.data);
  },

  getById: (id: string): Promise<ApiResponse<WorkOrder>> =>
    apiClient.get<ApiResponse<WorkOrder>>(`/work-orders/${id}`).then((r) => r.data),

  /**
   * Hızlı başlangıç: okutulan stok toplarını doğrula → WO oluştur → bağla (tek
   * istek). Online-only (mutation networkMode 'online'). Hiç top bağlanamazsa
   * backend WO'yu geri alır.
   */
  quickStart: (data: QuickStartRequest): Promise<ApiResponse<QuickStartResult>> =>
    apiClient
      .post<ApiResponse<QuickStartResult>>('/work-orders/quick-start', data)
      .then((r) => r.data),

  /**
   * Temel alan güncelle (PATCH /:id) — yalnız COMPLETED/CANCELLED reddedilir,
   * PLANNED ve IN_PROGRESS düzenlenebilir. Mobil "Düzenle" bunu kullanır (rota/
   * sipariş bağı dışındaki alanlar). Rota/adım değişimi replace ister (PLANNED + rol bağlı değil).
   */
  update: (id: string, data: WorkOrderUpdatePayload): Promise<ApiResponse<WorkOrder>> =>
    apiClient.patch<ApiResponse<WorkOrder>>(`/work-orders/${id}`, data).then((r) => r.data),

  /** Tam replace (rota/sipariş dahil) — yalnız PLANNED + üretime başlanmamış WO. PUT /:id. */
  replace: (id: string, data: WorkOrderPayload): Promise<ApiResponse<WorkOrder>> =>
    apiClient.put<ApiResponse<WorkOrder>>(`/work-orders/${id}`, data).then((r) => r.data),

  /** İptal (soft delete → CANCELLED). Önce getCancelImpact ile önizle. */
  cancel: (id: string): Promise<ApiResponse<WorkOrder>> =>
    apiClient.delete<ApiResponse<WorkOrder>>(`/work-orders/${id}`).then((r) => r.data),

  /** İptal önizleme — stoğa dönecek toplar + void kart sayısı + engel sebebi. */
  getCancelImpact: (id: string): Promise<ApiResponse<WorkOrderCancelImpact>> =>
    apiClient
      .get<ApiResponse<WorkOrderCancelImpact>>(`/work-orders/${id}/cancel-impact`)
      .then((r) => r.data),

  /** Refakat / iş emri kartı verisi (çıktı + görüntüleme). */
  getTravelCard: (id: string): Promise<ApiResponse<WorkOrderTravelCard>> =>
    apiClient
      .get<ApiResponse<WorkOrderTravelCard>>(`/work-orders/${id}/travel-card`)
      .then((r) => r.data),

  /** İş emrine bağlı (sepetteki) toplar. */
  getAttachedRolls: (id: string): Promise<ApiResponse<Roll[]>> =>
    apiClient.get<ApiResponse<Roll[]>>(`/work-orders/${id}/rolls`).then((r) => r.data),
};
