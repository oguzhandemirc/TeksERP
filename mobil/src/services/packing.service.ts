import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Tartı/Paket — yeni /api/shipping sözleşmesi (Sack = çuval)
// =============================================================================

export interface SackListItem {
  id: string;
  sackNo: string;
  status: 'OPEN' | 'CLOSED' | 'SHIPPED' | 'CANCELLED';
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

// =============================================================================
// Sevke Hazır (Mod A) — depoda etiketli + çuvalda olmayan topu olan siparişler
// =============================================================================

export interface ReadyLine {
  lineId: string;
  item: { id: string; code: string; name: string };
  color: { id: string; code: string; name: string } | null;
  width: number | null;
  customerItemName: string | null;
  customerColorName: string | null;
  requested: number;
  shipped: number;
  reserved: number;
  openQty: number;
  readyQty: number;
  readyCount: number;
}

export interface ReadyOrder {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    deadline: string | null;
    createdAt: string;
    customer: { id: string; code: string; name: string };
    branch: { id: string; name: string } | null;
  };
  lines: ReadyLine[];
}

export interface SackCancelPreview {
  sackId: string;
  sackNo: string;
  status: 'OPEN' | 'CLOSED' | 'SHIPPED' | 'CANCELLED';
  customerName: string;
  branchName: string | null;
  canCancel: boolean;
  reason: string | null;
  rolls: Array<{ id: string; barcode: string | null; currentQty: number; orderNumber: string | null }>;
  swatches: Array<{ id: string; barcode: string | null }>;
}

export interface ReprintItem {
  id: string;
  barcode: string | null;
  width: number | null;
  currentQty: number;
  status: string;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
  targetOrderLine: {
    customerItemName: string | null;
    customerColorName: string | null;
    order: { orderNumber: string; customer: { name: string } };
  } | null;
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

  /** Sevke hazır siparişler (Mod A girişi). Termine göre sıralı. */
  getReady: (): Promise<ApiResponse<ReadyOrder[]>> =>
    apiClient.get<ApiResponse<ReadyOrder[]>>('/shipping/ready').then((r) => r.data),

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

  /** Hızlı Okut (Mod C) — barkodla top okut, topun müşterisinin açık çuvalına otomatik ekle. */
  autoAssign: (
    barcode: string,
  ): Promise<
    ApiResponse<{
      sackId: string;
      sackNo: string;
      customerId: string;
      customerName: string;
      createdSack: boolean;
    }>
  > =>
    apiClient
      .post<
        ApiResponse<{
          sackId: string;
          sackNo: string;
          customerId: string;
          customerName: string;
          createdSack: boolean;
        }>
      >('/shipping/sacks/auto-assign', { barcode })
      .then((r) => r.data),

  /** Değişebilir etiket / yönlendir — topun sipariş atıfını değiştir (null = stoğa al). */
  relabel: (
    rollId: string,
    targetOrderLineId: string | null,
  ): Promise<
    ApiResponse<{
      rollId: string;
      customerName: string | null;
      specMismatch: boolean;
      reprintRequired: boolean;
      poppedFromSack?: boolean;
    }>
  > =>
    apiClient
      .post<
        ApiResponse<{
          rollId: string;
          customerName: string | null;
          specMismatch: boolean;
          reprintRequired: boolean;
          poppedFromSack?: boolean;
        }>
      >('/shipping/relabel', { rollId, targetOrderLineId })
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

  /** İptal önizleme — serbest bırakılacak top/kartelaları listeler (yıkıcı işlem onayı). */
  cancelPreview: (sackId: string): Promise<ApiResponse<SackCancelPreview>> =>
    apiClient
      .get<ApiResponse<SackCancelPreview>>(`/shipping/sacks/${sackId}/cancel-preview`)
      .then((r) => r.data),

  /** Çuvalı iptal et (soft delete → CANCELLED, top/kartela serbest bırakılır). */
  cancelSack: (sackId: string): Promise<ApiResponse<{ freedRolls: number; freedSwatches: number }>> =>
    apiClient
      .post<ApiResponse<{ freedRolls: number; freedSwatches: number }>>(
        `/shipping/sacks/${sackId}/cancel`,
        {},
      )
      .then((r) => r.data),

  /** Print-queue — yeniden basılacak etiketler (relabel sonrası, tambur). */
  getReprintQueue: (): Promise<ApiResponse<ReprintItem[]>> =>
    apiClient.get<ApiResponse<ReprintItem[]>>('/shipping/reprint-queue').then((r) => r.data),

  /** Etiket basıldı → topu kuyruktan düşür. */
  markReprinted: (rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/shipping/reprint-queue/done', { rollId })
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
