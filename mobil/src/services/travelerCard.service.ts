import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { TravelerCardLookup } from '../types/models';

export const travelerCardService = {
  // Refakat kartı barkodundan WO + steps + status. Mal kabul akışında
  // operatör kartı okuttuğunda iş emrini ve aktif EXTERNAL adımı çözümlemek için.
  findByBarcode: (barcode: string): Promise<ApiResponse<TravelerCardLookup | null>> =>
    apiClient
      .get<ApiResponse<TravelerCardLookup | null>>(
        `/traveler-cards/by-barcode/${encodeURIComponent(barcode)}`
      )
      .then((r) => r.data),

  // KK1 / Kurşun / Tambur picker'larında "kart seç" listesi.
  // Default ACTIVE — `filter.status: 'ALL'` ile tüm statüler çekilir.
  list: (
    params: Partial<QueryParams> = {}
  ): Promise<PaginatedResponse<TravelerCardLookup>> => {
    const finalParams: Partial<QueryParams> = {
      page: 1,
      pageSize: 30,
      sortBy: 'printedAt',
      sortOrder: 'desc',
      ...params,
    };
    return apiClient
      .get<PaginatedResponse<TravelerCardLookup>>(
        `/traveler-cards${buildQueryString(finalParams)}`
      )
      .then((r) => r.data);
  },
};
