import { apiClient } from './api';
import { buildQueryString } from '../utils/queryBuilder';
import type { ApiResponse, PaginatedResponse, QueryParams } from '../types/api';

/** Ürün reçetesi — Hızlı İş Emri "Basit" modda rota+renk+en+kat tipini tek seçimle doldurur. */
export interface ProductRecipe {
  id: string;
  code: string;
  name: string;
  itemId: string;
  colorId?: string | null;
  width?: number | null;
  foldType?: string | null;
  routeId?: string | null;
  isActive?: boolean;
  item?: { id: string; code: string; name: string };
  color?: { id: string; code?: string | null; name: string; hex?: string | null } | null;
  // defaultInclude property adını da döndürür → şablon detayında özellik isimleri gösterilir.
  properties?: { propertyId: string; property?: { id: string; code?: string | null; name: string } }[];
}

export const productRecipeService = {
  getAll: (params: Partial<QueryParams> = {}): Promise<PaginatedResponse<ProductRecipe>> =>
    apiClient
      .get<PaginatedResponse<ProductRecipe>>(`/product-recipes${buildQueryString(params)}`)
      .then((r) => r.data),

  getById: (id: string): Promise<ApiResponse<ProductRecipe>> =>
    apiClient.get<ApiResponse<ProductRecipe>>(`/product-recipes/${id}`).then((r) => r.data),
};
