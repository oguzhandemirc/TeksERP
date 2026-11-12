import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Roll, WorkOrder } from '../types/models';
import type {
  WorkOrderPayload,
  LinkableOrderLine,
  OrderLinkOverrideResult,
  WorkOrderUpdatePayload,
  QuickStartRequest,
  QuickStartResult,
  WorkOrderCancelImpact,
  WorkOrderTravelCard,
  WorkOrderCursorPage,
  WorkOrderCursorParams,
  WorkOrderTimelineItem,
  TargetColorPreview,
  DetachCandidate,
  WorkOrderMeterComparison,
} from './workOrder.types';

export type {
  WorkOrderStepInput,
  WorkOrderPayload,
  LinkableOrderLine,
  OrderLinkOverrideResult,
  WorkOrderUpdatePayload,
  QuickStartRequest,
  QuickStartResult,
  WorkOrderCancelImpact,
  WorkOrderTravelCard,
  WorkOrderCursorPage,
  WorkOrderCursorParams,
  WorkOrderTimelineItem,
  TargetColorPreview,
  DetachCandidate,
  WorkOrderMeterSummary,
  MeterParty,
  WorkOrderMeterComparison,
} from './workOrder.types';

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
    options?: { withOrderDetail?: boolean; hasOpenExternalStep?: boolean; withMeterSummary?: boolean; signal?: AbortSignal },
  ): Promise<WorkOrderCursorPage> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    if (params.limit) sp.set('limit', String(params.limit));
    if (params.cursor) sp.set('cursor', params.cursor);
    if (params.search) sp.set('search', params.search);
    if (params.sortBy) sp.set('sortBy', params.sortBy);
    if (params.sortOrder) sp.set('sortOrder', params.sortOrder);
    if (params.withTotal) sp.set('withTotal', 'true');
    if (params.dateField && (params.dateFrom || params.dateTo)) for (const [k, v] of Object.entries({ dateField: params.dateField, dateFrom: params.dateFrom, dateTo: params.dateTo })) if (v) sp.set(k, v);
    if (params.filters) {
      for (const [k, v] of Object.entries(params.filters)) {
        if (!v || (Array.isArray(v) && v.length === 0)) continue;
        const val = Array.isArray(v) ? v.join(',') : v;
        if (val) sp.set(`filter[${k}]`, val);
      }
    }
    if (options?.withOrderDetail) sp.set('withOrderDetail', 'true');
    if (options?.hasOpenExternalStep) sp.set('hasOpenExternalStep', 'true');
    // Satır başına `meterSummary` (beyan ↔ ölçülen metre); OPT-IN, eski sunucu parametreyi yok sayar.
    if (options?.withMeterSummary) sp.set('withMeterSummary', 'true');
    return apiClient
      .get<WorkOrderCursorPage>(`/work-orders?${sp.toString()}`, { signal: options?.signal })
      .then((r) => r.data);
  },

  /** Beyan ↔ ölçülen metre, parti başına (izin `workorder:read` | `mobile:hizli-is-emri`). */
  meterComparison: (id: string): Promise<WorkOrderMeterComparison> =>
    apiClient.get<ApiResponse<WorkOrderMeterComparison>>(`/work-orders/${id}/meter-comparison`).then((r) => r.data.data as WorkOrderMeterComparison),

  getById: (id: string): Promise<ApiResponse<WorkOrder>> =>
    apiClient.get<ApiResponse<WorkOrder>>(`/work-orders/${id}`).then((r) => r.data),

  /** Son hareketler (salt-okunur özet) — tam liste ve Excel panelde. */
  getRecentEvents: (id: string, limit = 5): Promise<WorkOrderTimelineItem[]> =>
    apiClient
      .get<{ data: WorkOrderTimelineItem[] }>(`/work-orders/${id}/events`, { params: { limit } })
      .then((r) => r.data.data),

  /**
   * Hızlı başlangıç: okutulan stok toplarını doğrula → WO oluştur → bağla (tek
   * istek). Online-only (mutation networkMode 'online'). Hiç top bağlanamazsa
   * backend WO'yu geri alır.
   */
  quickStart: (data: QuickStartRequest): Promise<ApiResponse<QuickStartResult>> =>
    apiClient.post<ApiResponse<QuickStartResult>>('/work-orders/quick-start', data).then((r) => r.data),

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

  // ── Sipariş bağlama (Tambur "Sipariş Bağla", 2026-08-19) ──────────────────
  /** İş emrinin hedefiyle UYUMLU açık sipariş satırları (kumaş+renk süzülü, en uyarı). */
  getLinkableOrderLines: (id: string): Promise<ApiResponse<LinkableOrderLine[]>> =>
    apiClient
      .get<ApiResponse<LinkableOrderLine[]>>(`/work-orders/${id}/linkable-order-lines`)
      .then((r) => r.data),

  /** Uyumlu satırı bağla — YALNIZ bağ kurar, hedef/rota/metraj DEĞİŞMEZ. */
  linkOrderLines: (
    id: string,
    orderLineIds: string[],
  ): Promise<ApiResponse<{ linked: number; alreadyLinked: number; warnings: string[]; typeChanged?: boolean }>> =>
    apiClient
      .post<ApiResponse<{ linked: number; alreadyLinked: number; warnings: string[]; typeChanged?: boolean }>>(
        `/work-orders/${id}/order-links`,
        { orderLineIds },
      )
      .then((r) => r.data),

  /**
   * Sipariş bağını KALDIR. Backend kuralları: iptal/devredilmiş iş emrinde 409;
   * **siparişe özel iş emrinin SON bağı kalkınca iş emri STOK üretimine döner**
   * (2026-08-21, tip = bağın aynası; yanıt `typeChanged`) — tek 400: hedef kumaşı
   * olmayan iş emri (STOK olamaz). İstemci bunu önden gösterir (`canUnlinkOrderLine`),
   * yarışta backend son sözü söyler.
   */
  unlinkOrderLine: (
    id: string,
    orderLineId: string,
  ): Promise<ApiResponse<{ removed: boolean; typeChanged?: boolean }>> =>
    apiClient
      .delete<ApiResponse<{ removed: boolean; typeChanged?: boolean }>>(`/work-orders/${id}/order-links/${orderLineId}`)
      .then((r) => r.data),

  // ── Düzeltme menüsü (hareket defteri D5; `mobile:is-emri-duzelt` ∨ `workorder:write`) ──
  /** Rengi Değiştir önizlemesi — yazmaz: engel · kısmi boya · sipariş uyarıları · kart bayatlığı. */
  previewTargetColor: (id: string, colorId: string | null): Promise<ApiResponse<TargetColorPreview>> =>
    apiClient
      .get<ApiResponse<TargetColorPreview>>(`/work-orders/${id}/target-color/preview`, { params: { colorId: colorId ?? '' } })
      .then((r) => r.data),

  /** Rengi değiştir — sebep zorunlu; kısmi boyada `confirmPartial` önizlemedeki onayla gelir. */
  changeTargetColor: (
    id: string,
    data: { colorId: string | null; reason: string; reasonCode?: string | null; confirmPartial?: boolean },
  ): Promise<ApiResponse<{ warnings: string[] }>> =>
    apiClient
      .patch<ApiResponse<{ warnings: string[] }>>(`/work-orders/${id}/target-color`, {
        colorId: data.colorId,
        reason: data.reason,
        ...(data.reasonCode ? { reasonCode: data.reasonCode } : {}),
        ...(data.confirmPartial ? { confirmPartial: true } : {}),
      })
      .then((r) => r.data),

  /** Eni değiştir — sebep zorunlu. */
  changeWidth: (
    id: string,
    data: { width: number | null; reason: string; reasonCode?: string | null },
  ): Promise<ApiResponse<{ previousWidth: number | null }>> =>
    apiClient
      .patch<ApiResponse<{ previousWidth: number | null }>>(`/work-orders/${id}/width`, {
        width: data.width,
        reason: data.reason,
        ...(data.reasonCode ? { reasonCode: data.reasonCode } : {}),
      })
      .then((r) => r.data),

  /** Top Çıkar önizlemesi — iş emrindeki her top çıkarılabilir mi, değilse neden. Yazmaz. */
  getDetachCandidates: (id: string): Promise<ApiResponse<DetachCandidate[]>> =>
    apiClient.get<ApiResponse<DetachCandidate[]>>(`/work-orders/${id}/detach-candidates`).then((r) => r.data),

  /** Top Çıkar — işlem görmemiş topu iş emrinden geri alır; sebep zorunlu. */
  detachRoll: (id: string, rollId: string, reason: string): Promise<ApiResponse<{ workOrderReverted: boolean }>> =>
    apiClient
      .post<ApiResponse<{ workOrderReverted: boolean }>>(`/work-orders/${id}/rolls/${rollId}/detach`, { reason })
      .then((r) => r.data),

  /** Refakat kartını yeniden bas — yeni sürüm doğar, eski kart geçersizleşir. */
  reprintTravelerCard: (id: string, reason: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/work-orders/${id}/traveler-cards/reprint`, { reason }).then((r) => r.data),

  /**
   * UYUMSUZ satırı onayla-düzelt-bağla zinciri (süpervizör): plan siparişe
   * eşitlenir + iş emrinin düzeltilebilir topları çekilir + bağ kurulur.
   * ÇİFT yetki ister: workorder:write + roll:manual-adjust. Kumaş farkı 400.
   */
  linkOrderLineWithOverride: (
    id: string,
    data: { orderLineId: string; reason: string },
  ): Promise<ApiResponse<OrderLinkOverrideResult>> =>
    apiClient
      .post<ApiResponse<OrderLinkOverrideResult>>(`/work-orders/${id}/order-links/override`, data)
      .then((r) => r.data),
};
