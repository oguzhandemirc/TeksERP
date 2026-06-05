import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type {
  ApiResponse,
  PaginatedResponse,
  CursorPaginatedResponse,
  QueryParams,
} from '../types/api';
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

/** Fason Sevk Geçmişi sayfası durum sekmesi. */
export type DispatchStatusFilter = 'all' | 'active' | 'cancelled';

interface ListDispatchesCursorParams {
  status?: DispatchStatusFilter;
  subcontractorId?: string;
  /** sevk no / fason firma / parti kodu araması (sunucu-taraflı). */
  search?: string;
  /** ISO tarih — bu andan sonraki sevkler (dönem filtresi). */
  dateFrom?: string;
  limit?: number;
  cursor?: string | null;
}

export interface DispatchRequest {
  workOrderId: string;
  stepId: string;
  subcontractorId: string;
  rollIds: string[];
  plateNumber?: string;
  driverName?: string;
  notes?: string;
  /** Boyahaneye özel talimat — genel sevk notundan ayrı. */
  dyehouseNote?: string;
  /**
   * WO ürünü ile rulo ürünü uyuşmazlığını bilinçli onayla. Frontend
   * mismatch modal'da onayladıktan sonra true gönderir.
   */
  allowItemOverride?: boolean;
}

/** Backend `details.code === 'ITEM_MISMATCH'` durumunda dönen yapı. */
export interface ItemMismatchDetails {
  code: 'ITEM_MISMATCH';
  expectedItemId: string;
  expectedItemLabel: string;
  mismatchedRolls: Array<{
    id: string;
    barcode: string | null;
    itemId: string;
    itemLabel: string;
  }>;
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

  /**
   * Fason Sevk Geçmişi sayfası: cursor (keyset) pagination + durum/firma/arama/
   * dönem filtresi. Sunucu-taraflı filtre → over-fetch yok; count yok → derin
   * sayfalamada sabit maliyet. `dispatchedAt desc + id desc` indeksli sıralama.
   */
  listDispatchesCursor: (
    params: ListDispatchesCursorParams = {}
  ): Promise<CursorPaginatedResponse<SubcontractorDispatchListItem>> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    if (params.status && params.status !== 'all') sp.set('status', params.status);
    if (params.subcontractorId) sp.set('subcontractorId', params.subcontractorId);
    if (params.search) sp.set('search', params.search);
    if (params.dateFrom) sp.set('dateFrom', params.dateFrom);
    sp.set('limit', String(params.limit ?? 30));
    if (params.cursor) sp.set('cursor', params.cursor);
    return apiClient
      .get<CursorPaginatedResponse<SubcontractorDispatchListItem>>(
        `/subcontractor/dispatches?${sp.toString()}`
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
    params: {
      workOrderId?: string;
      subcontractorId?: string;
      page?: number;
      pageSize?: number;
      /** 'yes' = iptal edilebilirler, 'no' = settled (artık iptal edilemez) */
      cancellable?: 'yes' | 'no';
    } = {},
  ): Promise<PaginatedResponse<SubcontractorReceiptListItem>> => {
    const sp = new URLSearchParams();
    if (params.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params.subcontractorId) sp.set('subcontractorId', params.subcontractorId);
    if (params.page) sp.set('page', String(params.page));
    if (params.pageSize) sp.set('pageSize', String(params.pageSize));
    if (params.cancellable) sp.set('cancellable', params.cancellable);
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
