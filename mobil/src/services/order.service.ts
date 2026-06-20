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

  /** Saha #11: ham/stok toplardan hızlı sipariş (okut→müşteri→otomatik satır). */
  quickFromRolls: (data: {
    customerId: string;
    branchId?: string | null;
    rollIds: string[];
  }): Promise<ApiResponse<QuickOrderResult>> =>
    apiClient.post<ApiResponse<QuickOrderResult>>('/orders/quick-from-rolls', data).then((r) => r.data),
};
