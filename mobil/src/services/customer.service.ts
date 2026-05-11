import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Customer } from '../types/models';

export const customerService = {
  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Customer>> =>
    apiClient
      .get<PaginatedResponse<Customer>>(`/customers${buildQueryString(params)}`)
      .then((r) => r.data),

  getById: (id: string): Promise<ApiResponse<Customer>> =>
    apiClient.get<ApiResponse<Customer>>(`/customers/${id}`).then((r) => r.data),
};
