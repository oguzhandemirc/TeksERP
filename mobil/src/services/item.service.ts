import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';
import type { Item } from '../types/models';

export const itemService = {
  getAll: (params: Partial<QueryParams>): Promise<PaginatedResponse<Item>> =>
    apiClient.get<PaginatedResponse<Item>>(`/items${buildQueryString(params)}`).then((r) => r.data),

  /**
   * Saha (KK1) hızlı desen oluşturma — YALNIZ ad gönderilir. Backend itemType'ı
   * FABRIC'e, kodu STK-NNNNNN'e, birimi MT'ye zorlar ve `pendingReview=true`
   * işaretler (admin gözden geçirir). `mobile:kk1-desen` yetkisi backend'de
   * zorunlu. Çevrimiçi-only: sunucu kod ürettiği için offline kuyruğa ALINMAZ
   * (çağıran plain useMutation + isOnline gate kullanır — bkz. KK1Screen).
   */
  quickCreateFabric: (name: string): Promise<ApiResponse<Item>> =>
    apiClient.post<ApiResponse<Item>>('/items/quick-create', { name }).then((r) => r.data),
};
