import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Color } from '../types/models';

export const colorService = {
  getAll: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<Color>> =>
    apiClient.get<PaginatedResponse<Color>>(`/colors${buildQueryString(params)}`).then((r) => r.data),

  /** Tek renk (seçili exclusive rengin adını göstermek için fallback). */
  getById: (id: string): Promise<ApiResponse<Color>> =>
    apiClient.get<ApiResponse<Color>>(`/colors/${id}`).then((r) => r.data),

  /**
   * Renk seçici için public renk listesi — müşteriye ATANMIŞ (assigned) renkler
   * hariç (`?scope=public`). Hızlı İş Emri stok üretimidir (müşterisiz); müşteriye
   * özel renkler orada listelenmez. (Electron picker'ı ile aynı kural.)
   */
  listPublicForPicker: (
    params: Partial<QueryParams> = {},
  ): Promise<PaginatedResponse<Color>> => {
    const qs = buildQueryString(params);
    const sep = qs ? '&' : '?';
    return apiClient
      .get<PaginatedResponse<Color>>(`/colors${qs}${sep}scope=public`)
      .then((r) => r.data);
  },
};
