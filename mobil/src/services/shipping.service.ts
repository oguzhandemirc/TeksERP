import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Sevkiyat — sack-tabanlı akış (mobil sevkiyat ekranı için)
// =============================================================================

export interface CreateShipmentRequest {
  customerId: string;
  branchId?: string;
  driverName?: string;
  plateNumber?: string;
  carrier?: string;
}

export interface ShipmentPlannedOrder {
  id: string;
  orderId: string;
  sortOrder: number;
  note: string | null;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    deadline: string | null;
    lines?: Array<{
      id: string;
      quantity: number;
      item: { id: string; code: string; name: string };
      variant: { id: string; code: string; name: string } | null;
    }>;
  };
}

export interface ShipmentSummary {
  id: string;
  shipmentNumber: string;
  customerId: string;
  branchId?: string | null;
  status: 'PREPARING' | 'SHIPPED' | 'CANCELLED';
  priority?: number;
  plannedDate?: string | null;
  driverName: string | null;
  plateNumber: string | null;
  carrier: string | null;
  shippedAt: string | null;
  customer?: { id: string; code: string; name: string };
  branch?: { id: string; name: string; code?: string | null } | null;
  customerNameSnapshot: string | null;
  customerCodeSnapshot: string | null;
  branchNameSnapshot?: string | null;
  plannedOrders?: ShipmentPlannedOrder[];
}

export interface ShipmentDetailItem {
  id: string;
  rollId: string;
  shippedQty: number;
  shippedWeight: number | null;
  roll?: {
    id: string;
    barcode: string;
    item?: { name: string };
    variant?: { name: string } | null;
    sackId: string | null;
  };
}

export interface ShipmentDetail extends ShipmentSummary {
  items: ShipmentDetailItem[];
  sacks?: Array<{
    id: string;
    sackNumber: string;
    weightKg: number | null;
    _count?: { rolls: number; swatches: number };
  }>;
}

export const shippingService = {
  // Sevkiyat oluştur (PREPARING)
  createShipment: (data: CreateShipmentRequest): Promise<ApiResponse<ShipmentSummary>> =>
    apiClient
      .post<ApiResponse<ShipmentSummary>>('/shipping/shipments', data)
      .then((r) => r.data),

  // Sevkiyatları listele (status filtreli)
  list: (params?: {
    status?: 'PREPARING' | 'SHIPPED' | 'CANCELLED';
    customerId?: string;
  }): Promise<ApiResponse<ShipmentSummary[]>> => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.customerId) qs.set('customerId', params.customerId);
    const q = qs.toString();
    return apiClient
      .get<ApiResponse<ShipmentSummary[]>>(`/shipping/shipments${q ? `?${q}` : ''}`)
      .then((r) => r.data);
  },

  // Tek sevkiyat detayı
  getById: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient.get<ApiResponse<ShipmentDetail>>(`/shipping/shipments/${id}`).then((r) => r.data),

  // Çuval ekle/çıkar
  addSack: (
    shipmentId: string,
    sackId: string
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${shipmentId}/add-sack`, {
        sackId,
      })
      .then((r) => r.data),

  removeSack: (
    shipmentId: string,
    sackId: string
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${shipmentId}/remove-sack`, {
        sackId,
      })
      .then((r) => r.data),

  // Finalize — sevkiyatı SHIPPED'a çek
  finalize: (shipmentId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${shipmentId}/finalize`)
      .then((r) => r.data),
};
