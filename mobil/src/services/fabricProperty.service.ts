import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { PaginatedResponse, QueryParams } from '../types/api';

/** Kumaş özellik kataloğu satırı (yanmazlık, su geçirmezlik vb). */
export interface FabricProperty {
  id: string;
  code: string;
  name: string;
  category?: string | null;
  description?: string | null;
  isActive: boolean;
}

export const fabricPropertyService = {
  /**
   * Hedef özellik seçici listesi. GET /fabric-properties `property:read` VEYA
   * `mobile:hizli-is-emri` kabul eder (bkz. fabric-property.routes.ts) — saha
   * kullanıcısında master-data izni yok.
   */
  getAll: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<FabricProperty>> =>
    apiClient
      .get<PaginatedResponse<FabricProperty>>(`/fabric-properties${buildQueryString(params)}`)
      .then((r) => r.data),
};
