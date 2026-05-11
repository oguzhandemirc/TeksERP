import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { WorkOrder } from '../types/models';

export const workOrderService = {
  // withOrderDetail=true → orderLinks (customer + ürün), targetColor, dispatchedTotalQty
  // alanları zenginleştirilir. Fason Sevk picker'ı için kullanılır.
  getAll: (
    params: Partial<QueryParams>,
    options?: { withOrderDetail?: boolean }
  ): Promise<PaginatedResponse<WorkOrder>> => {
    const qs = buildQueryString(params);
    const extra = options?.withOrderDetail ? (qs ? '&' : '?') + 'withOrderDetail=true' : '';
    return apiClient
      .get<PaginatedResponse<WorkOrder>>(`/work-orders${qs}${extra}`)
      .then((r) => r.data);
  },

  getById: (id: string): Promise<ApiResponse<WorkOrder>> =>
    apiClient.get<ApiResponse<WorkOrder>>(`/work-orders/${id}`).then((r) => r.data),
};
