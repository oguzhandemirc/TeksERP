import { apiClient } from './api';
import type { ApiResponse, CursorPaginatedResponse } from '../types/api';

// =============================================================================
// Tartı/Paket + Sevkiyat — GEVŞEK MODEL sözleşmesi (/api/shipping)
// Sevkiyat oturumu = tek müşteri+şube + seçilen siparişler + okutulan toplar +
// çuval tartıları + İÇERİK (çuval-önce: topu aktif çuvala okut). Karşılanma spec-toplam.
// =============================================================================

export type ShipmentStatus = 'PREPARING' | 'READY' | 'DISPATCHED' | 'CANCELLED';

export const SHIPMENT_STATUS_TR: Record<ShipmentStatus, string> = {
  PREPARING: 'Hazırlanıyor',
  READY: 'Hazır',
  DISPATCHED: 'Sevk Edildi',
  CANCELLED: 'İptal',
};

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
  /** İçinde bulunduğu çuval (top-level rolls'da döner). */
  sackId?: string | null;
}

/** Çuval içeriğindeki top (sack.rolls). */
export interface SackRoll {
  id: string;
  barcode: string | null;
  width: number | null;
  currentQty: number;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
}
export interface SackSwatch {
  id: string;
  barcode: string | null;
  length: number | null;
  width: number | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
}
export interface SackProductSummary {
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  width: number | null;
  totalQty: number;
  rollCount: number;
}
export interface ShipmentSack {
  id: string;
  sackNo: string;
  seq: number;
  /** Operatörün çuval üstüne elle yazdığı kod (sevke hazır/sevk için zorunlu). */
  manualCode: string | null;
  weightKg: number | null;
  rolls: SackRoll[];
  swatches: SackSwatch[];
  productSummary: SackProductSummary[];
  rollCount: number;
  swatchCount: number;
}
/** addSack lean dönüşü — yeni açılan boş çuval (içerik yok). */
export interface ShipmentSackLean {
  id: string;
  sackNo: string;
  seq: number;
  manualCode: string | null;
  weightKg: number | null;
}
/** Bu sevkiyattan iade edilmiş top (canlı rolls'ta yok; RollReturn'den). */
export interface ShipmentReturnedRoll {
  id: string;
  barcode: string | null;
  item: { code: string; name: string } | null;
  color: { code: string; name: string } | null;
  width: number | null;
  qty: number;
  returnedAt: string;
  reasonName: string | null;
  reasonColor: string | null;
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
  returnedRolls: ShipmentReturnedRoll[];
  summary: {
    rollCount: number;
    swatchCount: number;
    totalMeters: number;
    sackCount: number;
    totalKg: number;
    returnedCount: number;
    returnedMeters: number;
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

  // Sayfalı (cursor) liste — FlashList sonsuz kaydırma. Backend non-breaking cursor
  // (mode=cursor). Filtre: status + customerId (server). Geçmiş ekranı bunu kullanır.
  listShipmentsCursor: (params: {
    status?: ShipmentStatus;
    customerId?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<CursorPaginatedResponse<ShipmentListItem>> => {
    const q = new URLSearchParams();
    q.set('mode', 'cursor');
    q.set('limit', String(params.limit ?? 20));
    if (params.cursor) q.set('cursor', params.cursor);
    if (params.status) q.set('status', params.status);
    if (params.customerId) q.set('customerId', params.customerId);
    return apiClient
      .get<CursorPaginatedResponse<ShipmentListItem>>(`/shipping/shipments?${q.toString()}`)
      .then((r) => r.data);
  },

  addOrders: (id: string, orderIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/orders`, { orderIds }).then((r) => r.data),

  removeOrder: (id: string, orderId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-order`, { orderId }).then((r) => r.data),

  // ── Okutma ──
  scan: (
    id: string,
    barcode: string,
    sackId?: string | null,
  ): Promise<
    ApiResponse<{ kind: 'ROLL' | 'SWATCH'; rollId?: string; swatchId?: string; sackId?: string | null; currentQty?: number }>
  > =>
    apiClient
      .post<
        ApiResponse<{ kind: 'ROLL' | 'SWATCH'; rollId?: string; swatchId?: string; sackId?: string | null; currentQty?: number }>
      >(`/shipping/shipments/${id}/scan`, { barcode, ...(sackId ? { sackId } : {}) })
      .then((r) => r.data),

  removeRoll: (id: string, rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-roll`, { rollId }).then((r) => r.data),

  removeSwatch: (id: string, swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/shipments/${id}/remove-swatch`, { swatchId }).then((r) => r.data),

  // ── Çuval (aç / tart / içerik) ──
  // Çuval-önce: boş açılır (kg sonra weighSack ile). weightKg verilirse doğrudan tartılı açılır.
  addSack: (id: string, weightKg?: number): Promise<ApiResponse<ShipmentSackLean>> =>
    apiClient
      .post<ApiResponse<ShipmentSackLean>>(`/shipping/shipments/${id}/sacks`, weightKg != null ? { weightKg } : {})
      .then((r) => r.data),

  // Çuval kapat: brüt tartı + elle yazılan kod birlikte set edilir (kod zorunlu).
  weighSack: (sackId: string, weightKg: number, manualCode?: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/weigh`, {
        weightKg,
        ...(manualCode !== undefined ? { manualCode } : {}),
      })
      .then((r) => r.data),

  removeSack: (sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/sacks/${sackId}/remove`, {}).then((r) => r.data),

  // Topu çuvaldan çuvala taşı (aynı sevkiyat içi)
  moveRollToSack: (rollId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/shipping/rolls/${rollId}/move-sack`, { sackId }).then((r) => r.data),

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
