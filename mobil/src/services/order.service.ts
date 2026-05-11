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

export const orderService = {
  getReadyOrders: (): Promise<ApiResponse<ReadyOrder[]>> =>
    apiClient.get<ApiResponse<ReadyOrder[]>>('/shipping/ready-orders').then((r) => r.data),
};
