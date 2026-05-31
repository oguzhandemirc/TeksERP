import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Tartı/Paket — yeni /api/shipping sözleşmesi (Sack = çuval)
// =============================================================================

export interface SackListItem {
  id: string;
  sackNo: string;
  status: 'OPEN' | 'CLOSED' | 'SHIPPED';
  weightKg: number | null;
  shipmentId: string | null;
  createdAt: string;
  customer: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
  _count: { rolls: number; swatches: number };
}

export interface SackDetail {
  id: string;
  sackNo: string;
  status: string;
  weightKg: number | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
  shipment: { id: string; shipmentNo: string; status: string } | null;
  rolls: Array<{
    id: string;
    barcode: string | null;
    currentQty: number;
    status: string;
    targetOrderLineId: string | null;
  }>;
  swatches: Array<{ id: string; barcode: string | null; length: number }>;
}

export const packingService = {
  /** Çuval listesi — status (OPEN/CLOSED/SHIPPED), customerId, unassignedOnly filtreleri. */
  listSacks: (params?: {
    status?: 'OPEN' | 'CLOSED' | 'SHIPPED';
    customerId?: string;
    unassignedOnly?: boolean;
  }): Promise<ApiResponse<SackListItem[]>> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.unassignedOnly) q.set('unassignedOnly', 'true');
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<SackListItem[]>>(`/shipping/sacks${qs ? '?' + qs : ''}`)
      .then((r) => r.data);
  },

  getSack: (id: string): Promise<ApiResponse<SackDetail>> =>
    apiClient.get<ApiResponse<SackDetail>>(`/shipping/sacks/${id}`).then((r) => r.data),

  createSack: (data: {
    customerId: string;
    branchId?: string | null;
    sackNo?: string | null;
  }): Promise<ApiResponse<{ id: string; sackNo: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; sackNo: string }>>('/shipping/sacks', data)
      .then((r) => r.data),

  /** Topu çuvala ekle (müşteri etiketinden belli; backend müşteri uyumunu doğrular). */
  assignRoll: (data: {
    rollId: string;
    sackId: string;
    targetOrderLineId?: string | null;
  }): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/shipping/sacks/assign-roll', data).then((r) => r.data),

  removeRoll: (rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/shipping/sacks/remove-roll', { rollId }).then((r) => r.data),

  /** Çuvalı tart + kapat = "sevk edildi" anı. */
  weighClose: (sackId: string, weightKg: number): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/weigh`, { weightKg })
      .then((r) => r.data),
};

// =============================================================================
// Sevkiyat — İrsaliye (Shipment) = bir müşteri+şube
// =============================================================================

export interface ShipmentListItem {
  id: string;
  shipmentNo: string;
  status: 'PREPARING' | 'DISPATCHED' | 'CANCELLED';
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  customer: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
  _count: { sacks: number };
}

export const shipmentService = {
  list: (params?: {
    status?: 'PREPARING' | 'DISPATCHED' | 'CANCELLED';
    customerId?: string;
  }): Promise<ApiResponse<ShipmentListItem[]>> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.customerId) q.set('customerId', params.customerId);
    const qs = q.toString();
    return apiClient
      .get<ApiResponse<ShipmentListItem[]>>(`/shipping/shipments${qs ? '?' + qs : ''}`)
      .then((r) => r.data);
  },

  create: (data: {
    customerId: string;
    branchId?: string | null;
  }): Promise<ApiResponse<{ id: string; shipmentNo: string; status: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; shipmentNo: string; status: string }>>('/shipping/shipments', data)
      .then((r) => r.data),

  addSack: (shipmentId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${shipmentId}/add-sack`, { sackId })
      .then((r) => r.data),

  removeSack: (shipmentId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${shipmentId}/remove-sack`, { sackId })
      .then((r) => r.data),

  dispatch: (
    shipmentId: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
  ): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/shipments/${shipmentId}/dispatch`, data)
      .then((r) => r.data),
};
