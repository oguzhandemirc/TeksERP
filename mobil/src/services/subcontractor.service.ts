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
  PendingReturnSummary,
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
  /** Fason adım talimatı — genel sevk notundan ayrı. Boş gönderilirse backend
   *  adımın notes'unu default kullanır. */
  instruction?: string;
  /**
   * WO ürünü ile rulo ürünü uyuşmazlığını bilinçli onayla. Frontend
   * mismatch modal'da onayladıktan sonra true gönderir.
   */
  allowItemOverride?: boolean;
  /**
   * Rota sırasını atlayan sevki (ör. zımpara atlanıp doğrudan boyahaneye) bilinçli
   * onayla. Frontend ROUTE_SKIP uyarı modalında onayladıktan sonra true gönderir.
   */
  allowRouteSkip?: boolean;
}

/** Backend `details.code === 'ROUTE_SKIP'` durumunda dönen yapı. */
export interface RouteSkipDetails {
  code: 'ROUTE_SKIP';
  skippedStep: { id: string; stationName: string; stepSequence: number };
  targetStepSequence: number;
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

// ─────────────────────────────────────────────────────────────────────────────
// Fason KABUL — kart okutma teşhis kodları
// ─────────────────────────────────────────────────────────────────────────────
// `listPendingReturns` (WO'ya özel dal) bekleyen top bulamazsa artık jenerik
// "yanlış istasyon" demiyor; SEBEBİ söylüyor ve `details.code` ile hangi aksiyonun
// doğru olduğunu bildiriyor. Ekran bunlara göre KALICI aksiyon kartı çizer —
// toast kaybolur, operatör ne yapacağını yine bilmez.
// Şekiller backend `subcontractor.service.ts` `pendingCount === 0` dalından birebir.

/**
 * Kayıt fason adımında ama mal fasona **sevk edilmemiş** — "Konumu Düzelt"
 * topu tasarım gereği `AT_SUBCONTRACTOR` yapmaz (mal içeride bekler).
 * Doğru aksiyon: önce Fason Sevk, sonra kabul.
 */
export interface NeedsDispatchDetails {
  code: 'NEEDS_DISPATCH';
  workOrderId: string;
  stepId: string;
  stationName: string;
  rollCount: number;
}

/**
 * Bu iş emrinde iptal edilmemiş bir kabul makbuzu var. Mal fiziksel olarak hâlâ
 * fasondaysa doğru araç "Konumu Düzelt" DEĞİL, **kabul iptali**: orijinaller
 * `AT_SUBCONTRACTOR`'a döner ve sevk yeniden açılır.
 */
export interface MaybeWrongReceiptDetails {
  code: 'MAYBE_WRONG_RECEIPT';
  receiptId: string;
  receiptNo: string;
  /** ISO tarih (backend `Date` serialize eder). */
  receivedAt: string;
}

/**
 * Gerçekten başka bir istasyondayız. `currentSteps` fason adımlarını İÇERMEZ —
 * eski mesaj "fasonda bekleyen yok. Mevcut konum: Boyahane (Fason)" diyerek
 * kendini yalanlıyordu.
 */
export interface WoNotAtSubcontractorDetails {
  code: 'WO_NOT_AT_SUBCONTRACTOR';
  currentSteps: { stepId: string; stationName: string; rollCount: number }[];
}

/** Kart okutma hatasının `err.details` birleşimi (bilinmeyen kod = undefined). */
export type PendingReturnErrorDetails =
  | NeedsDispatchDetails
  | MaybeWrongReceiptDetails
  | WoNotAtSubcontractorDetails;

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

  /** Tüm bekleyen sevkler — rolls yok, liste için hafif özet. */
  pendingReturns: (): Promise<ApiResponse<PendingReturnSummary[]>> =>
    apiClient
      .get<ApiResponse<PendingReturnSummary[]>>('/subcontractor/pending-returns')
      .then((r) => r.data),

  /** Refakat kartı akışı — WO'ya özel, rolls dahil (küçük sonuç, auto-select için). */
  pendingReturnsByWorkOrder: (workOrderId: string): Promise<ApiResponse<PendingReturnGroup[]>> =>
    apiClient
      .get<ApiResponse<PendingReturnGroup[]>>(
        `/subcontractor/pending-returns?workOrderId=${encodeURIComponent(workOrderId)}`,
      )
      .then((r) => r.data),

  /** Seçim anında tek grup detayı — rolls lazy-load. */
  getPendingReturnGroup: (stepId: string): Promise<ApiResponse<PendingReturnGroup>> =>
    apiClient
      .get<ApiResponse<PendingReturnGroup>>(
        `/subcontractor/pending-returns/step/${encodeURIComponent(stepId)}`,
      )
      .then((r) => r.data),

  receive: (data: ReceiveRequest): Promise<ApiResponse<SubcontractorReceipt>> =>
    apiClient
      .post<ApiResponse<SubcontractorReceipt>>('/subcontractor/receive', data)
      .then((r) => r.data),

  /**
   * Fasonda kalan metrajı "gelmeyecek" kararıyla kapat (kısmi teslimat, 2026-08-19).
   * Top tüketilir, kalan metraj sapma defterine FİRE yazılır (sebep zorunlu —
   * fire kataloğundan). ONLINE aksiyon: offline kuyruğa GİRMEZ (fire kararı
   * taze veri ister; kuyruklanmış bir kapama bayat kalanla yanlış metraj yazardı).
   */
  closeRemainder: (data: {
    stepId: string;
    rollId: string;
    reasonCode: string;
    reasonText?: string | null;
  }): Promise<ApiResponse<{ rollId: string; closedQty: number }>> =>
    apiClient
      .post<ApiResponse<{ rollId: string; closedQty: number }>>(
        '/subcontractor/close-remainder',
        data,
      )
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

  /**
   * Geçmiş Kabuller sonsuz akışı: cursor (keyset) pagination. count yok
   * (withTotal opt-in) → derin sayfalamada sabit maliyet + MAX_OFFSET tavanı yok.
   * `receivedAt desc + id desc` indeksli sıralama. cancellable filtresi korunur.
   */
  listReceiptsCursor: (
    params: {
      workOrderId?: string;
      subcontractorId?: string;
      cancellable?: 'yes' | 'no';
      limit?: number;
      cursor?: string | null;
      withTotal?: boolean;
    } = {},
  ): Promise<CursorPaginatedResponse<SubcontractorReceiptListItem>> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    if (params.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params.subcontractorId) sp.set('subcontractorId', params.subcontractorId);
    if (params.cancellable) sp.set('cancellable', params.cancellable);
    sp.set('limit', String(params.limit ?? 20));
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.withTotal) sp.set('withTotal', 'true');
    return apiClient
      .get<CursorPaginatedResponse<SubcontractorReceiptListItem>>(
        `/subcontractor/receipts?${sp.toString()}`,
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
