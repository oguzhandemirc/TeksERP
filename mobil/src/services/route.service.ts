import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';

/** Üretim rota şablonu — Hızlı İş Emri'nde WO rotası seçimi için. */
export interface ProductionRoute {
  id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  isFavorite?: boolean;
  isActive?: boolean;
  steps?: {
    id: string;
    stationId: string;
    sequence: number;
    defaultNotes?: string | null;
    station?: { id: string; code?: string | null; name: string; type?: string };
  }[];
}

export const routeService = {
  getAll: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<ProductionRoute>> =>
    apiClient
      .get<PaginatedResponse<ProductionRoute>>(`/routes${buildQueryString(params)}`)
      .then((r) => r.data),

  getById: (id: string): Promise<ApiResponse<ProductionRoute>> =>
    apiClient.get<ApiResponse<ProductionRoute>>(`/routes/${id}`).then((r) => r.data),
};
