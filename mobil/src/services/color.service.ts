import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';
import type { Color } from '../types/models';

export const colorService = {
  getAll: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<Color>> =>
    apiClient.get<PaginatedResponse<Color>>(`/colors${buildQueryString(params)}`).then((r) => r.data),
};
