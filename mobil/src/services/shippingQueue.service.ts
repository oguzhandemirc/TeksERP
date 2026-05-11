import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Sevkiyat kuyruğu — operatör tarafı (sipariş seviyesinde)
// =============================================================================
// Planlamacı bir siparişi sevkiyat kuyruğuna alır. Operatör kuyruktan sırasını
// alır, sipariş gerekliliklerini görür, depodan kumaşları kendisi tarayıp
// çuvallara koyar, tartar ve "tamamlandı" işaretler.
// =============================================================================

export type ShippingQueueStatus = 'WAITING' | 'TAKEN' | 'DONE' | 'CANCELLED';

export interface ShippingQueueLineAllocation {
  rollId: string;
  barcode: string;
  rollStatus: string;
  sackId: string | null;
  allocatedQty: number;
}

export interface ShippingQueueLine {
  lineId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  variant: { id: string; code: string; name: string } | null;
  width: number | null;
  requestedQty: number;
  allocatedQty: number;
  remainingQty: number;
  allocations: ShippingQueueLineAllocation[];
}

export interface ShippingQueueJob {
  id: string;
  orderId: string;
  priority: number;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
  status: ShippingQueueStatus;
  note: string | null;
  addedBy: { id: string; fullName: string };
  assignedOperator: { id: string; fullName: string } | null;
  takenAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  order: {
    id: string;
    orderNumber: string;
    status: 'PENDING' | 'APPROVED' | 'PARTIAL_SHIPPED' | 'COMPLETED' | 'CANCELLED';
    orderDate: string;
    deadline: string | null;
    currency: string;
    totalAmount: string | null;
    customer: { id: string; code: string; name: string };
    branch: { id: string; name: string; city: string | null; district: string | null } | null;
    lines: ShippingQueueLine[];
    totalRequestedQty: number;
    totalAllocatedQty: number;
    remainingQty: number;
  };
}

export const shippingQueueService = {
  /** Kuyruğu listele — default WAITING + TAKEN. */
  list: (status?: ShippingQueueStatus | 'ALL'): Promise<ApiResponse<ShippingQueueJob[]>> => {
    const qs = status ? `?status=${status}` : '';
    return apiClient
      .get<ApiResponse<ShippingQueueJob[]>>(`/shipping-queue${qs}`)
      .then((r) => r.data);
  },

  /** Belirli işi al. */
  takeById: (id: string): Promise<ApiResponse<ShippingQueueJob>> =>
    apiClient
      .post<ApiResponse<ShippingQueueJob>>(`/shipping-queue/${id}/take`)
      .then((r) => r.data),

  /** Alınan işi geri bırak. */
  release: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/shipping-queue/${id}/release`)
      .then((r) => r.data),

  /** Operatör tamamlandı işaretler. */
  complete: (id: string): Promise<ApiResponse<{ id: string; allocatedRollCount: number }>> =>
    apiClient
      .post<ApiResponse<{ id: string; allocatedRollCount: number }>>(
        `/shipping-queue/${id}/complete`,
      )
      .then((r) => r.data),

  /** Sipariş gereklilikleri (canlı — tahsis toplamı vs.). */
  getRequirements: (id: string): Promise<ApiResponse<ShippingQueueJob>> =>
    apiClient
      .get<ApiResponse<ShippingQueueJob>>(`/shipping-queue/${id}/requirements`)
      .then((r) => r.data),
};
