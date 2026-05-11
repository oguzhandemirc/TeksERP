import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';
import type { QualityGrade } from '../types/models';

// Kalite derecesi kataloğu — admin yönetimli (FIRE/A1/2.KALITE vb.).
// Tambur ekranında "kesilen parçanın kalitesi" seçilirken aktif liste çekilir.

export const qualityGradeService = {
  list: (
    params: Partial<QueryParams> = {}
  ): Promise<PaginatedResponse<QualityGrade>> => {
    const finalParams: Partial<QueryParams> = {
      page: 1,
      pageSize: 100,
      sortBy: 'sortOrder',
      sortOrder: 'asc',
      ...params,
      filters: { isActive: 'true', ...(params.filters ?? {}) },
    };
    return apiClient
      .get<PaginatedResponse<QualityGrade>>(
        `/quality-grades${buildQueryString(finalParams)}`
      )
      .then((r) => r.data);
  },
};
