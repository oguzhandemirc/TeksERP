import { apiClient } from './api';
import type { ApiResponse, PaginatedResponse } from '../types/api';

// ---------------------------------------------------------------------------
// Types (backend kartela.service ile uyumlu)
// ---------------------------------------------------------------------------

export interface KartelaDispatchRequest {
  subcontractorId: string;
  rollIds: string[];
  plateNumber?: string | null;
  driverName?: string | null;
  notes?: string | null;
}

export interface KartelaReceiveMeasure {
  lengthCm?: number | null;
  weightKg?: number | null;
}

export interface KartelaReceiveReturn {
  rollId: string;
  count: number;
  /** Toplu ölçüm — bu toptan dönen tüm kartelalara uygulanır. */
  bulkLengthCm?: number | null;
  bulkWeightKg?: number | null;
  /** Tek-tek ölçüm — varsa length === count olmalı. */
  items?: KartelaReceiveMeasure[];
  notes?: string | null;
}

export interface KartelaReceiveRequest {
  subcontractorId: string;
  dispatchId?: string | null;
  manifestNo?: string | null;
  notes?: string | null;
  returns: KartelaReceiveReturn[];
}

export interface KartelaDispatchListItem {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: number;
  cancelledAt: string | null;
  subcontractor: { id: string; name: string; code: string | null };
  _count: { items: number; receipts: number };
}

export interface KartelaReceiptListItem {
  id: string;
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  cancelledAt: string | null;
  subcontractor: { id: string; name: string; code: string | null };
  _count: { items: number; swatches: number };
}

/** Kabul worklist'i — firmadaki AT_KARTELA toplar (KartelaDispatchItem bazlı). */
export interface KartelaOutstandingItem {
  dispatchedQty: number;
  dispatchedWeight: number | null;
  dispatch: {
    id: string;
    dispatchNo: string;
    dispatchedAt: string;
    subcontractor: { id: string; name: string };
  };
  roll: {
    id: string;
    barcode: string | null;
    currentQty: number;
    width: number | null;
    weightKg: number | null;
    qualityGrade: string;
    markedForKartela: boolean;
    item: { code: string; name: string };
    color: { code: string; name: string } | null;
  };
}

interface ListParams {
  subcontractorId?: string;
  includeCancelled?: boolean;
  page?: number;
  pageSize?: number;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const kartelaService = {
  // ── Sevk ──
  dispatch: (data: KartelaDispatchRequest): Promise<ApiResponse<KartelaDispatchListItem>> =>
    apiClient
      .post<ApiResponse<KartelaDispatchListItem>>('/kartela/dispatch', data)
      .then((r) => r.data),

  cancelDispatch: (id: string, reason: string): Promise<ApiResponse<{ id: string; dispatchNo: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; dispatchNo: string }>>(`/kartela/dispatches/${id}/cancel`, { reason })
      .then((r) => r.data),

  listDispatches: (params: ListParams = {}): Promise<PaginatedResponse<KartelaDispatchListItem>> =>
    apiClient
      .get<PaginatedResponse<KartelaDispatchListItem>>(
        `/kartela/dispatches${qs({
          subcontractorId: params.subcontractorId,
          includeCancelled: params.includeCancelled,
          page: params.page,
          pageSize: params.pageSize,
        })}`
      )
      .then((r) => r.data),

  getDispatch: (id: string): Promise<ApiResponse<unknown>> =>
    apiClient.get<ApiResponse<unknown>>(`/kartela/dispatches/${id}`).then((r) => r.data),

  // ── Kabul ──
  outstanding: (subcontractorId?: string): Promise<ApiResponse<KartelaOutstandingItem[]>> =>
    apiClient
      .get<ApiResponse<KartelaOutstandingItem[]>>(`/kartela/outstanding${qs({ subcontractorId })}`)
      .then((r) => r.data),

  receive: (data: KartelaReceiveRequest): Promise<ApiResponse<KartelaReceiptListItem>> =>
    apiClient
      .post<ApiResponse<KartelaReceiptListItem>>('/kartela/receive', data)
      .then((r) => r.data),

  listReceipts: (params: ListParams = {}): Promise<PaginatedResponse<KartelaReceiptListItem>> =>
    apiClient
      .get<PaginatedResponse<KartelaReceiptListItem>>(
        `/kartela/receipts${qs({
          subcontractorId: params.subcontractorId,
          includeCancelled: params.includeCancelled,
          page: params.page,
          pageSize: params.pageSize,
        })}`
      )
      .then((r) => r.data),

  getReceipt: (id: string): Promise<ApiResponse<unknown>> =>
    apiClient.get<ApiResponse<unknown>>(`/kartela/receipts/${id}`).then((r) => r.data),

  cancelReceipt: (id: string, reason: string): Promise<ApiResponse<{ id: string; receiptNo: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; receiptNo: string }>>(`/kartela/receipts/${id}/cancel`, { reason })
      .then((r) => r.data),

  // ── Kartelalık işareti ──
  setRollMarked: (rollId: string, value: boolean): Promise<ApiResponse<{ id: string; markedForKartela: boolean }>> =>
    apiClient
      .post<ApiResponse<{ id: string; markedForKartela: boolean }>>(`/kartela/rolls/${rollId}/mark`, { value })
      .then((r) => r.data),
};
