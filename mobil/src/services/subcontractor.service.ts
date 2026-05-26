import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type {
  SubcontractorDispatch,
  SubcontractorDispatchListItem,
  Subcontractor,
  SubcontractorCategory,
  PendingReturnGroup,
  ReceiveRequest,
  SubcontractorReceipt,
  SubcontractorReceiptListItem,
  CancelReceiptRequest,
  ReceiptCancelPreview,
} from '../types/models';

interface ListDispatchesParams {
  workOrderId?: string;
  subcontractorId?: string;
  page?: number;
  pageSize?: number;
}

export interface DispatchRequest {
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  rollIds: string[];
  plateNumber?: string;
  driverName?: string;
  notes?: string;
}

export interface CancelDispatchRequest {
  reason: string;
}

export const subcontractorService = {
  dispatch: (data: DispatchRequest): Promise<ApiResponse<SubcontractorDispatch>> =>
    apiClient
      .post<ApiResponse<SubcontractorDispatch>>('/subcontractor/dispatch', data)
      .then((r) => r.data),

  cancelDispatch: (
    id: string,
    data: CancelDispatchRequest
  ): Promise<ApiResponse<{ id: string; dispatchNo: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; dispatchNo: string }>>(
        `/subcontractor/dispatches/${id}/cancel`,
        data
      )
      .then((r) => r.data),

  listDispatches: (
    params: ListDispatchesParams = {}
  ): Promise<PaginatedResponse<SubcontractorDispatchListItem>> => {
    const sp = new URLSearchParams();
    if (params.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params.subcontractorId) sp.set('subcontractorId', params.subcontractorId);
    if (params.page) sp.set('page', String(params.page));
    if (params.pageSize) sp.set('pageSize', String(params.pageSize));
    const qs = sp.toString();
    return apiClient
      .get<PaginatedResponse<SubcontractorDispatchListItem>>(
        `/subcontractor/dispatches${qs ? `?${qs}` : ''}`
      )
      .then((r) => r.data);
  },

  // ── Subcontractor (firma) yönetimi listesi ──
  listSubcontractors: (
    params: Partial<QueryParams> = {}
  ): Promise<PaginatedResponse<Subcontractor>> =>
    apiClient
      .get<PaginatedResponse<Subcontractor>>(`/subcontractors${buildQueryString(params)}`)
      .then((r) => r.data),

  getSubcontractor: (id: string): Promise<ApiResponse<Subcontractor>> =>
    apiClient.get<ApiResponse<Subcontractor>>(`/subcontractors/${id}`).then((r) => r.data),

  // ── Kategori listesi ──
  listCategories: (
    params: Partial<QueryParams> = {}
  ): Promise<PaginatedResponse<SubcontractorCategory>> =>
    apiClient
      .get<PaginatedResponse<SubcontractorCategory>>(
        `/subcontractor-categories${buildQueryString(params)}`
      )
      .then((r) => r.data),

  getDispatch: (id: string): Promise<ApiResponse<SubcontractorDispatch>> =>
    apiClient
      .get<ApiResponse<SubcontractorDispatch>>(`/subcontractor/dispatches/${id}`)
      .then((r) => r.data),

  // ── Mal Kabul (Receipt) ─────────────────────────────────────────────────────

  /**
   * Fasonda bekleyen sevkler. workOrderId verilirse sadece o WO'nun grupları döner
   * (refakat kartı tarama akışı için).
   */
  pendingReturns: (workOrderId?: string): Promise<ApiResponse<PendingReturnGroup[]>> => {
    const qs = workOrderId ? `?workOrderId=${encodeURIComponent(workOrderId)}` : '';
    return apiClient
      .get<ApiResponse<PendingReturnGroup[]>>(`/subcontractor/pending-returns${qs}`)
      .then((r) => r.data);
  },

  receive: (data: ReceiveRequest): Promise<ApiResponse<SubcontractorReceipt>> =>
    apiClient
      .post<ApiResponse<SubcontractorReceipt>>('/subcontractor/receive', data)
      .then((r) => r.data),

  listReceipts: (
    params: { workOrderId?: string; subcontractorId?: string; page?: number; pageSize?: number } = {}
  ): Promise<PaginatedResponse<SubcontractorReceiptListItem>> => {
    const sp = new URLSearchParams();
    if (params.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params.subcontractorId) sp.set('subcontractorId', params.subcontractorId);
    if (params.page) sp.set('page', String(params.page));
    if (params.pageSize) sp.set('pageSize', String(params.pageSize));
    const qs = sp.toString();
    return apiClient
      .get<PaginatedResponse<SubcontractorReceiptListItem>>(
        `/subcontractor/receipts${qs ? `?${qs}` : ''}`
      )
      .then((r) => r.data);
  },

  getReceipt: (id: string): Promise<ApiResponse<SubcontractorReceipt>> =>
    apiClient
      .get<ApiResponse<SubcontractorReceipt>>(`/subcontractor/receipts/${id}`)
      .then((r) => r.data),

  /**
   * Fason kabul iptal önizlemesi — receipt'ten türeyen açık kumaş Roll'larını
   * ve her birinin cascade güvenliğini döner. UI bunu kullanarak operatöre
   * "şu top'lar da iptal edilecek" onay listesini gösterir.
   */
  getCancelPreview: (id: string): Promise<ApiResponse<ReceiptCancelPreview>> =>
    apiClient
      .get<ApiResponse<ReceiptCancelPreview>>(
        `/subcontractor/receipts/${id}/cancel-preview`
      )
      .then((r) => r.data),

  /**
   * Fason kabulü iptal et (soft cancel). Receipt'teki rulolar AT_SUBCONTRACTOR'a
   * geri döner; renk uygulandıysa Roll.colorId/RollProperty silinir.
   * bornRoll türemişse `cascadeRollIds` zorunlu (preview'den alınan tam liste);
   * downstream'i olan roll varsa 409.
   */
  cancelReceipt: (
    id: string,
    data: CancelReceiptRequest
  ): Promise<ApiResponse<{ id: string; receiptNo: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; receiptNo: string }>>(
        `/subcontractor/receipts/${id}/cancel`,
        data
      )
      .then((r) => r.data),
};
