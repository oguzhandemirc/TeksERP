import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// PLANLI sevkiyatın yükünü düzenleme (9.1–9.3) — okutarak yük ekle, dökme/arabadan tek top çıkar,
// sevk öncesi İE önizlemesi. Uçlar yeni sunucuda; eski sunucu 404 verir → çağıran hatayı gösterir.
// =============================================================================

export interface AddLoadResult {
  kind: 'SACK' | 'ROLL';
  added: number;
  rollId?: string;
  sackId?: string;
  /** Okutulan topun metresi (top yolu). */
  qty?: number;
  barcode?: string | null;
  sackNo?: string;
  unitKind?: 'SACK' | 'CART' | 'BULK';
  unitLabel?: string | null;
}

export interface LoadPreviewWorkOrder {
  workOrderId: string;
  workOrderNo: string;
  inLoad: number;
  inLoadMeters: number;
  total: number;
  shippedElsewhere: number;
  remaining: number;
  remainingInProcess: number;
  sourceDocs: { noteNo: string; senderDocNo: string | null }[];
}

export interface LoadPreview {
  rollCount: number;
  totalMeters: number;
  workOrders: LoadPreviewWorkOrder[];
  noWorkOrder: { rollCount: number; meters: number };
  owners: { customerId: string | null; name: string | null; rollCount: number }[];
  /** Sunucu metni (istemci uyarı üretmez). */
  warnings: string[];
}

export const shipmentLoadService = {
  /** Çuval kodu → çuval; top barkodu → `unitKind` (BULK/CART + araba no) birimine. Token okutma başına. */
  addByScan: (
    shipmentId: string,
    body: { barcode: string; unitKind?: 'BULK' | 'CART' | null; unitLabel?: string | null; clientToken: string },
  ): Promise<ApiResponse<AddLoadResult>> =>
    apiClient.post<ApiResponse<AddLoadResult>>(`/shipping/shipments/${shipmentId}/add-scan`, body).then((r) => r.data),

  /** Dökme/arabadan tek top çıkar → rafa; son topsa birim sevkiyattan düşer (`unitDissolved`). */
  removeRoll: (shipmentId: string, rollId: string): Promise<ApiResponse<{ unitDissolved: boolean }>> =>
    apiClient
      .post<ApiResponse<{ unitDissolved: boolean }>>(`/shipping/shipments/${shipmentId}/remove-roll`, { rollId })
      .then((r) => r.data),

  /** Sevk öncesi yük önizlemesi — salt-okur, engellemez. */
  preview: (body: { shipmentId?: string; rollIds?: string[]; sackIds?: string[]; customerId?: string | null }): Promise<ApiResponse<LoadPreview>> =>
    apiClient.post<ApiResponse<LoadPreview>>('/shipping/shipments/load-preview', body).then((r) => r.data),
};
