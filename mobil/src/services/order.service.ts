import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Sevkiyat ekranı için sipariş listesi
// =============================================================================
// TartıPaket artık sipariş seçmez (kuyruktan çeker — packagingQueue.service);
// bu dosya sadece sevkiyat ekranının ihtiyacı olan ready-orders'ı tutar.
// =============================================================================

export interface ReadyOrderLine {
  lineId: string;
  itemName: string;
  itemCode?: string;
  variantName?: string | null;
  variantCode?: string | null;
  requestedQty: number;
  allocatedRolls: Array<{
    rollId: string;
    barcode: string;
    currentQty: number;
    status: string;
  }>;
}

export interface ReadyOrder {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerId: string;
  status: string;
  deadline: string | null;
  lines: ReadyOrderLine[];
}

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
  colorCode: string | null;
  colorName: string | null;
  customerColorName: string | null;
  width: number | null;
  quantity: number;
  openQty: number;
}

export const orderService = {
  getReadyOrders: (): Promise<ApiResponse<ReadyOrder[]>> =>
    apiClient.get<ApiResponse<ReadyOrder[]>>('/shipping/ready-orders').then((r) => r.data),

  /** Özelliğe (itemId + opsiyonel colorId/width) uyan açık sipariş kalemleri. */
  getAvailableOrderLines: (params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
  }): Promise<ApiResponse<AvailableOrderLine[]>> => {
    const q = new URLSearchParams({ itemId: params.itemId });
    if (params.colorId) q.set('colorId', params.colorId);
    if (params.width != null) q.set('width', String(params.width));
    return apiClient
      .get<ApiResponse<AvailableOrderLine[]>>(`/orders/order-lines/available?${q.toString()}`)
      .then((r) => r.data);
  },
};
