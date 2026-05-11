import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';
import type { DefectType } from '../types/models';

// Hata tipi kataloğu — admin tarafından yönetilen DefectType listesi.
// Operatör hata kaydı yaparken bu listeden seçer (serbest metin yasak).

export const defectTypeService = {
  // İstasyon ekranlarında sadece aktif tipler dolar.
  list: (
    params: Partial<QueryParams> = {}
  ): Promise<PaginatedResponse<DefectType>> => {
    const finalParams: Partial<QueryParams> = {
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortOrder: 'asc',
      ...params,
      filters: { isActive: 'true', ...(params.filters ?? {}) },
    };
    return apiClient
      .get<PaginatedResponse<DefectType>>(`/defect-types${buildQueryString(finalParams)}`)
      .then((r) => r.data);
  },
};
