import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';
import type { Item } from '../types/models';

export const itemService = {
  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Item>> =>
    apiClient.get<PaginatedResponse<Item>>(`/items${buildQueryString(params)}`).then((r) => r.data),
};
