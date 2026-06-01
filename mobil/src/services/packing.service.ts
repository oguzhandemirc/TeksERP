import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Tartı/Paket + Sevkiyat — GEVŞEK MODEL sözleşmesi (/api/shipping)
// Sevkiyat oturumu = tek müşteri+şube + seçilen siparişler + okutulan toplar +
// çuval tartıları. Çuval = sadece no+kg (içerik yok). Karşılanma spec-toplam.
// =============================================================================

export type ShipmentStatus = 'PREPARING' | 'READY' | 'DISPATCHED' | 'CANCELLED';

interface Ref {
  id: string;
  code?: string;
  name: string;
}

// ── Sipariş seçim ekranı (open-orders + depo karşılaması) ──
export interface OpenOrderLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  openQty: number;
  warehouseAvailable: number;
  covered: boolean;
}
export interface OpenOrder {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    deadline: string | null;
    customer: Ref;
    branch: { id: string; name: string } | null;
    /** Doluysa sipariş zaten aktif bir sevkiyatta → ekranda "Sürdür". */
    activeShipment: { id: string; shipmentNo: string; status: ShipmentStatus } | null;
  };
  lines: OpenOrderLine[];
}

// ── Sevkiyat detayı (paketleme ekranı) ──
export interface ShipmentDetailLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  openQty: number;
  thisShipment: number;
}
export interface ShipmentDetailOrder {
  id: string;
  orderNumber: string;
  status: string;
  deadline: string | null;
  lines: ShipmentDetailLine[];
}
export interface ShipmentDetailRoll {
  id: string;
  barcode: string | null;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
  width: number | null;
  currentQty: number;
}
export interface ShipmentSack {
  id: string;
  sackNo: string;
  seq: number;
  weightKg: number | null;
}
export interface ShipmentDetail {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  customer: Ref;
  branch: { id: string; name: string } | null;
  orders: ShipmentDetailOrder[];
  rolls: ShipmentDetailRoll[];
  swatches: Array<{ id: string; barcode: string | null; length: number; width: number | null }>;
  sacks: ShipmentSack[];
  summary: {
    rollCount: number;
    swatchCount: number;
    totalMeters: number;
    sackCount: number;
    totalKg: number;
  };
}

export interface ShipmentListItem {
  id: string;
  shipmentNo: string;
  status: ShipmentStatus;
  plateNumber: string | null;
  driverName: string | null;
  carrier: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  createdAt: string;
  customer: Ref;
  branch: { id: string; name: string } | null;
  _count: { sacks: number; rolls: number; orders: number };
}

export interface ShipmentCancelPreview {
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  customerName: string;
  branchName: string | null;
  canCancel: boolean;
  reason: string | null;
  rolls: Array<{ id: string; barcode: string | null; currentQty: number; itemName: string; colorName: string | null }>;
  swatchCount: number;
  sackCount: number;
  affectedOrders: Array<{ orderNumber: string; qty: string }>;
}

export const packingService = {
  // ── Sipariş seçim ──
  listOpenOrders: (params?: { customerId?: string; branchId?: string }): Promise<ApiResponse<OpenOrder[]>> => {
    const q = new URLSearchParams();
    if (params?.customerId) q.set('customerId', params.customerId);
    if (params?.branchId) q.set('branchId', params.branchId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<OpenOrder[]>>(`/shipping/open-orders${qs ? '?' + qs : ''}`).then((r) => r.data);
  },

  // ── Sevkiyat oturumu ──
  createShipment: (orderIds: string[]): Promise<ApiResponse<{ id: string; shipmentNo: string; status: ShipmentStatus }>> =>
    apiClient
      .post<ApiResponse<{ id: string; shipmentNo: string; status: ShipmentStatus }>>('/shipping/shipments', { orderIds })
      .then((r) => r.data),

  getShipment: (id: string): Promise<ApiResponse<ShipmentDetail>> =>
    apiClient.get<ApiResponse<ShipmentDetail>>(`/shipping/shipments/${id}`).then((r) => r.data),

  listShipments: (params?: { status?: ShipmentStatus; customerId?: string }): Promise<ApiResponse<ShipmentListItem[]>> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.customerId) q.set('customerId', params.customerId);
    const qs = q.toString();
    return apiClient.get<ApiResponse<ShipmentListItem[]>>(`/shipping/shipments${qs ? '?' + qs : ''}`).then((r) => r.data);
  },

  addOrders: (id: string, orderIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/orders`, { orderIds }).then((r) => r.data),

  removeOrder: (id: string, orderId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-order`, { orderId }).then((r) => r.data),

  // ── Okutma ──
  scan: (
    id: string,
    barcode: string,
  ): Promise<ApiResponse<{ kind: 'ROLL' | 'SWATCH'; rollId?: string; swatchId?: string; currentQty?: number }>> =>
    apiClient
      .post<ApiResponse<{ kind: 'ROLL' | 'SWATCH'; rollId?: string; swatchId?: string; currentQty?: number }>>(
        `/shipping/shipments/${id}/scan`,
        { barcode },
      )
      .then((r) => r.data),

  removeRoll: (id: string, rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-roll`, { rollId }).then((r) => r.data),

  removeSwatch: (id: string, swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-swatch`, { swatchId }).then((r) => r.data),

  // ── Çuval (tartı) ──
  addSack: (id: string, weightKg: number): Promise<ApiResponse<ShipmentSack>> =>
    apiClient.post<ApiResponse<ShipmentSack>>(`/shipping/shipments/${id}/sacks`, { weightKg }).then((r) => r.data),

  weighSack: (sackId: string, weightKg: number): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/weigh`, { weightKg }).then((r) => r.data),

  removeSack: (sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/remove`, {}).then((r) => r.data),

  // ── Sevke Hazır / Sevk / İptal ──
  markReady: (id: string): Promise<ApiResponse<{ shipmentId: string; rollCount: number; allocatedLines: number }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string; rollCount: number; allocatedLines: number }>>(
        `/shipping/shipments/${id}/ready`,
        {},
      )
      .then((r) => r.data),

  dispatch: (
    id: string,
    data: { plateNumber?: string | null; driverName?: string | null; carrier?: string | null },
  ): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/dispatch`, data).then((r) => r.data),

  cancelPreview: (id: string): Promise<ApiResponse<ShipmentCancelPreview>> =>
    apiClient.get<ApiResponse<ShipmentCancelPreview>>(`/shipping/shipments/${id}/cancel-preview`).then((r) => r.data),

  cancel: (id: string): Promise<ApiResponse<{ shipmentId: string; freedRolls: number }>> =>
    apiClient
      .post<ApiResponse<{ shipmentId: string; freedRolls: number }>>(`/shipping/shipments/${id}/cancel`, {})
      .then((r) => r.data),
};
