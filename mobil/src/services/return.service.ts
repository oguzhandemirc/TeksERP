import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';

// =============================================================================
// İade (müşteri iadesi) — backend /api/returns. QR ile sevk edilmiş top okutulur,
// Hazır Depo'ya alınır; RollReturn defterine yazılır (sevk muhasebesine dokunmaz).
// =============================================================================

export interface ReturnLookupRoll {
  id: string;
  barcode: string | null;
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  currentQty: number;
  qualityGrade: string;
  qualityGradeRef: { id: string; code: string; name: string; color: string | null } | null;
}

export interface ReturnCandidateOrder {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
}

export interface ReturnLookupResult {
  roll: ReturnLookupRoll;
  shipment: { id: string; shipmentNo: string; dispatchedAt: string | null } | null;
  customer: { id: string; code: string; name: string } | null;
  branch: { id: string; name: string } | null;
  candidateOrders: ReturnCandidateOrder[];
  returnGradingEnabled: boolean;
}

export interface ReturnReason {
  id: string;
  code: string;
  name: string;
  color: string | null;
}

export interface CreateReturnPayload {
  rollId: string;
  orderId?: string | null;
  reasonId?: string | null;
  reasonText?: string | null;
  note?: string | null;
  qualityGradeId?: string | null;
}

// İade kaydını düzelt — yalnız defter alanları (neden + not). Gönderilmeyen alan dokunulmaz.
export interface EditReturnPayload {
  reasonId?: string | null;
  reasonText?: string | null;
  note?: string | null;
}

// İade anında topa uygulanan raf (override'a göre). WAREHOUSE | A1_STOCK | SCRAP.
export type ReturnAppliedStatus = 'WAREHOUSE' | 'A1_STOCK' | 'SCRAP';

// --- İade geçmişi (liste + detay + iptal) ---
export type ReturnCancelledFilter = 'active' | 'cancelled' | 'all';

export interface ReturnRow {
  id: string;
  qty: number;
  width: number | null;
  reasonText: string | null;
  note: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  roll: { id: string; barcode: string | null; status?: string } | null;
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string } | null;
  customer: { id: string; code: string; name: string } | null;
  order: { id: string; orderNumber: string; status: string } | null;
  reason: { id: string; code: string; name: string; color: string | null } | null;
  qualityGrade: { id: string; code: string; name: string; color: string | null } | null;
  fromShipment: { id: string; shipmentNo: string } | null;
  receivedBy: { id: string; fullName: string } | null;
  cancelledBy: { id: string; fullName: string } | null;
}

export interface ReturnCursorParams {
  cancelled?: ReturnCancelledFilter;
  customerId?: string | null;
  limit?: number;
  cursor?: string | null;
}

export interface ReturnCursorPage {
  success: boolean;
  data: ReturnRow[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number };
  summary?: { count: number; totalQty: number };
}

export const returnService = {
  /** QR okut → top + sevkiyat + aday siparişler + returnGradingEnabled. */
  lookup: (barcode: string): Promise<ApiResponse<ReturnLookupResult>> =>
    apiClient
      .get<ApiResponse<ReturnLookupResult>>(`/returns/lookup?barcode=${encodeURIComponent(barcode)}`)
      .then((r) => r.data),

  /** İade al → top iade rafına (WAREHOUSE/A1_STOCK/SCRAP), defter kaydı. */
  create: (
    payload: CreateReturnPayload,
  ): Promise<ApiResponse<{ id: string; rollId: string; appliedStatus: ReturnAppliedStatus }>> =>
    apiClient
      .post<ApiResponse<{ id: string; rollId: string; appliedStatus: ReturnAppliedStatus }>>('/returns', payload)
      .then((r) => r.data),

  /** İade kaydını düzelt (neden + not) — top statüsü/sevkiyatı değişmez. */
  edit: (
    id: string,
    payload: EditReturnPayload,
  ): Promise<ApiResponse<{ id: string; rollId: string }>> =>
    apiClient
      .patch<ApiResponse<{ id: string; rollId: string }>>(`/returns/${id}`, payload)
      .then((r) => r.data),

  /** İade nedeni kataloğu (aktif). İade ekranında seçenek listesi. */
  listReasons: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<ReturnReason>> => {
    const finalParams: Partial<QueryParams> = {
      page: 1,
      pageSize: 100,
      sortBy: 'sortOrder',
      sortOrder: 'asc',
      ...params,
      filters: { isActive: 'true', ...(params.filters ?? {}) },
    };
    return apiClient
      .get<PaginatedResponse<ReturnReason>>(`/return-reasons${buildQueryString(finalParams)}`)
      .then((r) => r.data);
  },

  /** İade geçmişi (cursor). cancelled: active(default)/cancelled/all. */
  listCursor: (params: ReturnCursorParams = {}): Promise<ReturnCursorPage> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    sp.set('cancelled', params.cancelled ?? 'active');
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.customerId) sp.set('customerId', params.customerId);
    return apiClient.get<ReturnCursorPage>(`/returns?${sp.toString()}`).then((r) => r.data);
  },

  /** Tek iade kaydı detayı. */
  getById: (id: string): Promise<ApiResponse<ReturnRow>> =>
    apiClient.get<ApiResponse<ReturnRow>>(`/returns/${id}`).then((r) => r.data),

  /** İadeyi iptal et (geri al) — sebep zorunlu; top sevkiyatına geri döner. */
  cancel: (id: string, reason: string): Promise<ApiResponse<{ id: string; rollId: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; rollId: string }>>(`/returns/${id}/cancel`, { reason })
      .then((r) => r.data),
};
