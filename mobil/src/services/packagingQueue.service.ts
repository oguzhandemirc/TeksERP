import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Paketleme kuyruğu — operatör tarafı (rulo seviyesinde)
// =============================================================================
// Bir kuyruk satırı = bir rulonun paketleme görevi. Planlamacı önceden depodaki
// rulları açık siparişlere atar. Operatör sadece sıradakini alır ve tartıp
// paketler. Eski "siparişin tüm rulları havuzdan seç" akışı kaldırıldı.
// =============================================================================

export interface QueueRollInfo {
  id: string;
  barcode: string;
  status: string;
  initialQty: number;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  ownerCustomerId: string | null;
  item: { id: string; code: string; name: string };
  variant: { id: string; code: string; name: string } | null;
  ownerCustomer: { id: string; code: string; name: string } | null;
}

export interface QueuePlannedOrderInfo {
  id: string;
  orderNumber: string;
  status: 'PENDING' | 'APPROVED' | 'PARTIAL_SHIPPED' | 'COMPLETED' | 'CANCELLED';
  deadline: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; name: string } | null;
}

export interface QueueJob {
  id: string;
  rollId: string;
  plannedOrderId: string | null;
  priority: number;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
  status: 'WAITING' | 'TAKEN';
  note: string | null;
  takenAt?: string | null;
  createdAt?: string;
  roll: QueueRollInfo;
  plannedOrder: QueuePlannedOrderInfo | null;
}

export type TakenJob = QueueJob;

export interface QueuePagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type QueueListResponse = ApiResponse<QueueJob[]> & {
  pagination: QueuePagination;
};

export const packagingQueueService = {
  /** Bekleyen kuyruk listesi (sayfalı) — operatör hangi ruloyu alacağına karar verir. */
  listAvailable: (params?: { limit?: number; offset?: number }): Promise<QueueListResponse> => {
    const sp = new URLSearchParams();
    if (params?.limit != null) sp.set('limit', params.limit.toString());
    if (params?.offset != null) sp.set('offset', params.offset.toString());
    const qs = sp.toString();
    return apiClient
      .get<QueueListResponse>(`/packaging-queue/available${qs ? `?${qs}` : ''}`)
      .then((r) => r.data);
  },

  /** Operatörün listeden seçtiği kaydı al (TAKEN). 409 → başkası önce aldı. */
  takeById: (id: string): Promise<ApiResponse<QueueJob>> =>
    apiClient.post<ApiResponse<QueueJob>>(`/packaging-queue/${id}/take`).then((r) => r.data),
};
