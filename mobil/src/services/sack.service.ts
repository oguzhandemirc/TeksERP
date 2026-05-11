import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Tartı/Paket: Sack (Çuval) servis
// =============================================================================

export interface CreateSackRequest {
  customerId: string;
  notes?: string;
}

export interface AssignRollRequest {
  rollId: string;
  sackId: string;
  orderLineId?: string | null;
  weightKg?: number | null;
}

export interface AssignSwatchRequest {
  swatchId: string;
  sackId: string;
  weightKg?: number | null;
}

export interface WeighSackRequest {
  sackId: string;
  weightKg: number;
}

export interface UpdateSackCustomerRequest {
  sackId: string;
  customerId: string;
}

export interface SackPoolRoll {
  id: string;
  barcode: string;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: string;
  ownerCustomerId: string | null;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
  allocations: Array<{
    orderLine: {
      id: string;
      order: { id: string; orderNumber: string; customerId: string };
    };
  }>;
}

export interface SackPoolSwatch {
  id: string;
  barcode: string;
  length: number;
  width: number | null;
  weightKg: number | null;
  item?: { id: string; code: string; name: string };
  variant?: { id: string; code: string; name: string } | null;
  parentRoll?: { id: string; barcode: string };
}

export interface SackPool {
  rolls: SackPoolRoll[];
  swatches: SackPoolSwatch[];
}

export interface SackListItem {
  id: string;
  sackNumber: string;
  weightKg: number | null;
  notes: string | null;
  shipmentId: string | null;
  rollCount: number;
  swatchCount: number;
  totalQty: number;
  createdAt: string;
}

export interface SackDetailRoll {
  id: string;
  barcode: string;
  currentQty: number;
  weightKg: number | null;
  qualityGrade: string;
  item?: { code: string; name: string };
  variant?: { code: string; name: string } | null;
  allocations: Array<{
    allocatedQty: number;
    orderLine: { id: string; order: { orderNumber: string } };
  }>;
}

export interface SackDetail {
  id: string;
  sackNumber: string;
  weightKg: number | null;
  notes: string | null;
  shipmentId: string | null;
  customer: { id: string; code: string; name: string };
  shipment?: { id: string; shipmentNumber: string; status: string } | null;
  rolls: SackDetailRoll[];
  swatches: Array<{
    id: string;
    barcode: string;
    length: number;
    weightKg: number | null;
    item?: { code: string; name: string };
  }>;
}

export const sackService = {
  create: (data: CreateSackRequest): Promise<ApiResponse<{ id: string; sackNumber: string }>> =>
    apiClient.post<ApiResponse<{ id: string; sackNumber: string }>>('/sacks', data).then((r) => r.data),

  remove: (sackId: string): Promise<ApiResponse<{ deleted: true }>> =>
    apiClient.delete<ApiResponse<{ deleted: true }>>(`/sacks/${sackId}`).then((r) => r.data),

  updateCustomer: (data: UpdateSackCustomerRequest): Promise<ApiResponse<unknown>> =>
    apiClient.patch<ApiResponse<unknown>>('/sacks/update-customer', data).then((r) => r.data),

  weigh: (data: WeighSackRequest): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/sacks/weigh', data).then((r) => r.data),

  assignRoll: (data: AssignRollRequest): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/sacks/assign-roll', data).then((r) => r.data),

  removeRoll: (rollId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/sacks/remove-roll', { rollId }).then((r) => r.data),

  assignSwatch: (data: AssignSwatchRequest): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/sacks/assign-swatch', data).then((r) => r.data),

  removeSwatch: (swatchId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>('/sacks/remove-swatch', { swatchId }).then((r) => r.data),

  getById: (sackId: string): Promise<ApiResponse<SackDetail>> =>
    apiClient.get<ApiResponse<SackDetail>>(`/sacks/${sackId}`).then((r) => r.data),

  listByCustomer: (customerId: string): Promise<ApiResponse<SackListItem[]>> =>
    apiClient
      .get<ApiResponse<SackListItem[]>>(`/sacks/by-customer?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => r.data),

  getPool: (params?: { customerId?: string }): Promise<ApiResponse<SackPool>> => {
    const qs = params?.customerId ? `?customerId=${encodeURIComponent(params.customerId)}` : '';
    return apiClient.get<ApiResponse<SackPool>>(`/sacks/pool${qs}`).then((r) => r.data);
  },

  /** Tüm açık (sevkiyata bağlanmamış) çuvallar — müşteriye göre gruplanmak için. */
  listAllOpen: (): Promise<ApiResponse<OpenSackOverview[]>> =>
    apiClient
      .get<ApiResponse<OpenSackOverview[]>>('/sacks/open')
      .then((r) => r.data),
};

export interface OpenSackOverview {
  id: string;
  sackNumber: string;
  weightKg: number | null;
  customer: { id: string; code: string; name: string };
  shipment: { id: string; shipmentNumber: string; status: string } | null;
  rollCount: number;
  totalQty: number;
  totalRollWeight: number;
  createdAt: string;
}
