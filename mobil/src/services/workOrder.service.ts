import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { WorkOrder } from '../types/models';

export const workOrderService = {
  // withOrderDetail=true → orderLinks (customer + ürün), targetColor, dispatchedTotalQty
  // alanları zenginleştirilir. Fason Sevk picker'ı için kullanılır.
  // excludeWithOpenDispatch=true → adımlarından birinde halen iptal edilmemiş ve
  // mal kabulü tam yapılmamış bir sevki olan WO'ları liste-dışı bırakır
  // (operatör önce eski sevki iptal etmek zorunda).
  getAll: (
    params: Partial<QueryParams>,
    options?: { withOrderDetail?: boolean; excludeWithOpenDispatch?: boolean }
  ): Promise<PaginatedResponse<WorkOrder>> => {
    const qs = buildQueryString(params);
    const extras: string[] = [];
    if (options?.withOrderDetail) extras.push('withOrderDetail=true');
    if (options?.excludeWithOpenDispatch) extras.push('excludeWithOpenDispatch=true');
    const sep = qs ? '&' : '?';
    const extra = extras.length ? sep + extras.join('&') : '';
    return apiClient
      .get<PaginatedResponse<WorkOrder>>(`/work-orders${qs}${extra}`)
      .then((r) => r.data);
  },

  getById: (id: string): Promise<ApiResponse<WorkOrder>> =>
    apiClient.get<ApiResponse<WorkOrder>>(`/work-orders/${id}`).then((r) => r.data),
};
