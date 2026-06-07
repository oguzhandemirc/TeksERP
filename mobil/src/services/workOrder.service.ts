import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { WorkOrder } from '../types/models';

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
};
