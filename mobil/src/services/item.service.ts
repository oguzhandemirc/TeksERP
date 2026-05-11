import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Item, ItemVariant } from '../types/models';

export const itemService = {
  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Item>> =>
    apiClient.get<PaginatedResponse<Item>>(`/items${buildQueryString(params)}`).then((r) => r.data),

  getVariants: (itemId: string): Promise<ApiResponse<ItemVariant[]>> =>
    apiClient.get<ApiResponse<ItemVariant[]>>(`/items/${itemId}/variants`).then((r) => r.data),
};
