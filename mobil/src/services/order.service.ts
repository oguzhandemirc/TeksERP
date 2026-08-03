import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Sipariş servisleri — Tambur "Kime?" picker'ı + sipariş bağı yardımcıları.
// L fix (2026-06-13): ReadyOrder/getReadyOrders kaldırıldı — backend'de hiç
// var olmayan /shipping/ready-orders'a (eski, silinen sevkiyat tasarımının
// kalıntısı) gidiyordu; hiçbir ekran çağırmıyordu.
// =============================================================================

/** Bir topun özelliğine uyan açık sipariş kalemi (Açık>0). Tambur yeniden-kes "Kime?" picker'ı. */
export interface AvailableOrderLine {
  lineId: string;
  /** Kalemin ürünü — sipariş-önce'de WO ürününü kilitler + anchor (tek WO=tek kumaş). */
  itemId: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  branchName: string | null;
  itemCode: string;
  itemName: string;
  customerItemName: string | null;
  colorId: string | null;
  colorCode: string | null;
  colorName: string | null;
  customerColorName: string | null;
  width: number | null;
  quantity: number;
  openQty: number;
  /** Yalnız withInProduction istendiğinde dolar (Hızlı İş Emri). */
  inProduction?: number;
  /** Net açık = açık − üretimdeki (withInProduction). Yoksa openQty kullan. */
  netOpenQty?: number;
  /**
   * Bu KALEME (spec havuzuna değil) canlı bir iş emri bağlı mı — iptal/devredilmiş
   * WO sayılmaz. Yalnız cursor modda döner. `inProduction` ile karıştırma: o,
   * aynı kumaş+renk+en havuzundaki BAŞKA kalemler yüzünden de dolu olabilir.
   */
  hasWorkOrder?: boolean;
}

/** Cursor (keyset) sayfa cevabı — "sipariş-önce" aramalı liste infinite scroll. */
export interface AvailableOrderLinesCursorPage {
  success: boolean;
  data: AvailableOrderLine[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    totalEstimate?: number;
  };
}

export interface QuickOrderResult {
  order: { id: string; orderNumber: string };
  lineCount: number;
  rollCount: number;
  preparedToWarehouse: number;
}

export const orderService = {
  /** Özelliğe (itemId + opsiyonel colorId/width) uyan açık sipariş kalemleri. */
  getAvailableOrderLines: (params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
    /** true → satırlara inProduction + netOpenQty eklenir (Hızlı İş Emri). */
    withInProduction?: boolean;
  }): Promise<ApiResponse<AvailableOrderLine[]>> => {
    const q = new URLSearchParams({ itemId: params.itemId });
    if (params.colorId) q.set('colorId', params.colorId);
    if (params.width != null) q.set('width', String(params.width));
    if (params.withInProduction) q.set('withInProduction', 'true');
    return apiClient
      .get<ApiResponse<AvailableOrderLine[]>>(`/orders/order-lines/available?${q.toString()}`)
      .then((r) => r.data);
  },

  /**
   * Açık sipariş kalemleri — cursor (keyset) + BACKEND araması (sipariş no /
   * müşteri / ürün / müşteri ürün adı; `buildTurkishSearch`).
   *
   * `itemId` opsiyonel: verilirse o kumaşın kalemleri (top-önce), verilmezse tüm
   * açık kalemler (sipariş-önce). Hızlı İş Emri picker'ı İKİ durumda da bunu
   * kullanır — sayfasız varyant (`getAvailableOrderLines`) sınırsız payload
   * döndürüyordu ve aramayı hiç desteklemiyordu.
   *
   * `withInProduction` yalnız `itemId` ile anlamlıdır (havuz kumaş bazlı); broad
   * modda backend zaten atlar.
   */
  getAvailableOrderLinesCursor: (params: {
    itemId?: string | null;
    search?: string | null;
    cursor?: string | null;
    limit?: number;
    withTotal?: boolean;
    withInProduction?: boolean;
    customerId?: string | null;
    colorId?: string | null;
    /**
     * "Bu kalemle aynı iş emrinde üretilebilecekler" — backend verilen satırın
     * spec'ini (kumaş + renk + en) okuyup listeyi ona daraltır; kumaş/renk/en
     * parametrelerini EZER. Uyumsuz kalemler istemciye hiç inmez.
     */
    specOfLineId?: string | null;
  }): Promise<AvailableOrderLinesCursorPage> => {
    const q = new URLSearchParams();
    if (params.itemId) q.set('itemId', params.itemId);
    if (params.customerId) q.set('customerId', params.customerId);
    if (params.colorId) q.set('colorId', params.colorId);
    if (params.specOfLineId) q.set('specOfLineId', params.specOfLineId);
    if (params.search) q.set('search', params.search);
    if (params.cursor) q.set('cursor', params.cursor);
    q.set('limit', String(params.limit ?? 20));
    if (params.withTotal) q.set('withTotal', 'true');
    if (params.withInProduction) q.set('withInProduction', 'true');
    return apiClient
      .get<AvailableOrderLinesCursorPage>(`/orders/order-lines/available?${q.toString()}`)
      .then((r) => r.data);
  },

  /** Saha #11: ham/stok toplardan hızlı sipariş (okut→müşteri→otomatik satır). */
  quickFromRolls: (data: {
    customerId: string;
    branchId?: string | null;
    rollIds: string[];
    /** İdempotency anahtarı — timeout-replay'de mükerrer sipariş önlenir. */
    clientToken?: string;
  }): Promise<ApiResponse<QuickOrderResult>> =>
    apiClient.post<ApiResponse<QuickOrderResult>>('/orders/quick-from-rolls', data).then((r) => r.data),
};
