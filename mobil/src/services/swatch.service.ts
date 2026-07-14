import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { KartelaStockGroup } from './packing.service';

export type { KartelaStockGroup };

export interface SwatchStats {
  count: number;
  /** Filtreye uyan tüm kartelaların `length` toplamı — cm. */
  totalLength: number;
}

export interface SwatchCursorPage {
  success: boolean;
  data: SwatchListItem[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
  };
}

// =============================================================================
// Swatch (Kartela) — TartıPaket scan akışında kartela barkodu çözümlemesi
// =============================================================================

export interface SwatchByBarcode {
  id: string;
  barcode: string;
  cardNumber: string;
  length: number;
  width: number | null;
  weightKg: number | null;
  sackId: string | null;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
  parentRoll?: {
    id: string;
    barcode: string;
  } | null;
}

export interface SwatchListItem {
  id: string;
  barcode: string;
  cardNumber: string;
  length: number | string;
  width: number | string | null;
  weightKg: number | string | null;
  itemId: string;
  colorId: string | null;
  workOrderId: string | null;
  parentRollId: string | null;
  purpose: string | null;
  createdAt: string;
  item?: { id: string; code: string; name: string } | null;
  color?: { id: string; code: string; name: string } | null;
  workOrder?: { id: string; workOrderNumber?: string | null } | null;
  parentRoll?: { id: string; barcode: string } | null;
}

export const swatchService = {
  getByBarcode: (barcode: string): Promise<ApiResponse<SwatchByBarcode | null>> =>
    apiClient
      .get<ApiResponse<SwatchByBarcode | null>>(
        `/swatches/by-barcode/${encodeURIComponent(barcode)}`
      )
      .then((r) => r.data),

  list: (params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
  }): Promise<ApiResponse<SwatchListItem[]>> => {
    const sp = new URLSearchParams();
    if (params?.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params?.itemId) sp.set('itemId', params.itemId);
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return apiClient
      .get<ApiResponse<SwatchListItem[]>>(`/swatches${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  /** Cursor-pagination liste — infinite scroll. Backend search: barcode, cardNumber, item.name, item.code, workOrder.batchNumber. */
  listCursor: (params?: {
    workOrderId?: string;
    itemId?: string;
    limit?: number;
    cursor?: string | null;
    search?: string;
  }): Promise<SwatchCursorPage> => {
    const sp = new URLSearchParams();
    sp.set('mode', 'cursor');
    if (params?.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params?.itemId) sp.set('itemId', params.itemId);
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.cursor) sp.set('cursor', params.cursor);
    if (params?.search) sp.set('search', params.search);
    return apiClient
      .get<SwatchCursorPage>(`/swatches?${sp.toString()}`)
      .then((r) => r.data);
  },

  /** TÜM kartelaların özeti — filtreye uyan (workOrderId/itemId/search). */
  getStats: (params?: {
    workOrderId?: string;
    itemId?: string;
    search?: string;
  }): Promise<ApiResponse<SwatchStats>> => {
    const sp = new URLSearchParams();
    if (params?.workOrderId) sp.set('workOrderId', params.workOrderId);
    if (params?.itemId) sp.set('itemId', params.itemId);
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    return apiClient
      .get<ApiResponse<SwatchStats>>(`/swatches/stats${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  /** Kartela stoğu — ürün+renk bazında müsait adet ("depoda kaç tane var"). */
  getStock: (search?: string): Promise<ApiResponse<KartelaStockGroup[]>> =>
    apiClient
      .get<ApiResponse<KartelaStockGroup[]>>(
        `/kartela/stock${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      )
      .then((r) => r.data),

  /** Bir ürün+renk grubundan N kartelayı elle stoktan düş (gerekçeli soft-cancel). */
  reduceStock: (body: {
    itemId: string;
    colorId: string | null;
    count: number;
    reason: string;
  }): Promise<ApiResponse<{ reduced: number }>> =>
    apiClient
      .post<ApiResponse<{ reduced: number }>>(`/kartela/stock/reduce`, body)
      .then((r) => r.data),
};
