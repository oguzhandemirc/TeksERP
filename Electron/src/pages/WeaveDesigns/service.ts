// Desen kartı ekranının tüm uçları — `apiClient` tek kapısı, yollar TAM (`/api/...`).
// Uçlar `requireDokumaEnabled` arkasında (modül kapalı → 403 MODULE_DISABLED); süzme sunucuda.
import apiClient from "@/services/apiClient";
import { buildQueryString } from "@/lib/query-builder";
import { PICKER_MAX_PAGE_SIZE } from "@/lib/picker-loader";
import type { ApiResponse, PaginatedResponse } from "@/types/api";
import { previewCost } from "@/pages/Cost/Items/service";
import type { CostPreview } from "@/pages/Cost/shared/cost-types";
import type {
  DesignFabric,
  DesignVariant,
  EffectiveConstruction,
  WarpBeamMode,
  WeaveDesign,
  WeaveDesignInput,
  WeftSpecDetail,
  WeftSpecForkResult,
} from "./types";

const BASE = "/api/weave-designs";

export const weaveDesignApi = {
  list: (opts: { search?: string; includeInactive?: boolean }) => {
    const sp = new URLSearchParams();
    if (opts.search) sp.set("search", opts.search);
    if (opts.includeInactive) sp.set("includeInactive", "1");
    const qs = sp.toString();
    return apiClient.get<ApiResponse<WeaveDesign[]>>(`${BASE}${qs ? `?${qs}` : ""}`).then((r) => r.data.data);
  },
  get: (id: string) => apiClient.get<ApiResponse<WeaveDesign>>(`${BASE}/${id}`).then((r) => r.data.data),
  create: (body: WeaveDesignInput) => apiClient.post<ApiResponse<WeaveDesign>>(BASE, body).then((r) => r.data.data),
  update: (id: string, body: WeaveDesignInput) =>
    apiClient.patch<ApiResponse<WeaveDesign>>(`${BASE}/${id}`, body).then((r) => r.data.data),
  deactivate: (id: string) => apiClient.delete<ApiResponse<{ id: string }>>(`${BASE}/${id}`).then((r) => r.data),
  activate: (id: string) => apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${id}/activate`).then((r) => r.data),
};

export const constructionApi = {
  get: (itemId: string, recipeId?: string | null) =>
    apiClient
      .get<ApiResponse<EffectiveConstruction>>(`/api/item-construction/${itemId}${recipeId ? `?recipeId=${recipeId}` : ""}`)
      .then((r) => r.data.data),
  putWarpLayers: (itemId: string, layers: Array<{ warpSpecId: string; role: string; beamMode: WarpBeamMode }>) =>
    apiClient
      .put<ApiResponse<EffectiveConstruction>>(`/api/item-construction/${itemId}/warp-layers`, { layers })
      .then((r) => r.data.data),
  putWeftOverrides: (recipeId: string, overrides: Array<{ weftSortOrder: number; yarnItemId: string }>) =>
    apiClient
      .put<ApiResponse<EffectiveConstruction>>(`/api/item-construction/recipes/${recipeId}/weft-yarns`, { overrides })
      .then((r) => r.data.data),
};

/** Desene bağlı kumaşlar — `filter[weaveDesignId]` sunucuda süzülür. */
export function listDesignFabrics(designId: string) {
  const qs = buildQueryString({ pageSize: PICKER_MAX_PAGE_SIZE, sortBy: "code", sortOrder: "asc", filters: { weaveDesignId: designId } });
  return apiClient.get<PaginatedResponse<DesignFabric>>(`/api/items${qs}`).then((r) => r.data.data);
}

/** Atkı kartını kullanan kumaş sayısı ("N kumaşta kullanılıyor" bandı) — sayım sunucuda (`pagination.total`). */
export function countWeftSpecUsers(weftSpecId: string) {
  const qs = buildQueryString({ pageSize: 1, filters: { weftSpecId } });
  return apiClient.get<PaginatedResponse<DesignFabric>>(`/api/items${qs}`).then((r) => r.data.pagination.total);
}

/** Atkı kartını kullanan kumaşlar — özel kopya onayında "eski kartta kalanlar" listesi (süzme sunucuda).
 *  `total` sayfa sınırında kesilen kısmı "+N kumaş daha" diye söylemek için döner. */
export function listWeftSpecUsers(weftSpecId: string) {
  const qs = buildQueryString({ pageSize: PICKER_MAX_PAGE_SIZE, sortBy: "code", sortOrder: "asc", filters: { weftSpecId } });
  return apiClient.get<PaginatedResponse<DesignFabric>>(`/api/items${qs}`).then((r) => ({ rows: r.data.data, total: r.data.pagination.total }));
}

export function listItemVariants(itemId: string) {
  const qs = buildQueryString({ pageSize: PICKER_MAX_PAGE_SIZE, sortBy: "code", sortOrder: "asc", filters: { itemId } });
  return apiClient.get<PaginatedResponse<DesignVariant>>(`/api/product-recipes${qs}`).then((r) => r.data.data);
}

export function createVariant(body: { name: string; itemId: string; colorId: string | null; variantCode: string; finishingRateCode: string | null }) {
  return apiClient.post<ApiResponse<DesignVariant>>("/api/product-recipes", body).then((r) => r.data.data);
}

export const weftSpecApi = {
  get: (id: string) => apiClient.get<ApiResponse<WeftSpecDetail>>(`/api/weft-specs/${id}`).then((r) => r.data.data),
  update: (id: string, body: Record<string, unknown>) =>
    apiClient.patch<ApiResponse<WeftSpecDetail>>(`/api/weft-specs/${id}`, body).then((r) => r.data.data),
  /** "Bu desene özel kopya" — kartı kopyalar, YALNIZ `itemId` kumaşını yeni karta geçirir (SY-P3). */
  fork: (id: string, body: { itemId: string; code: string; name: string }) =>
    apiClient.post<ApiResponse<WeftSpecForkResult>>(`/api/weft-specs/${id}/fork`, body).then((r) => r.data.data),
};

/** Kumaşın standart maliyet önizlemesi — sayı yalnız sunucudan (istemci hesaplamaz). */
export function previewFabricCost(itemId: string): Promise<CostPreview> {
  return previewCost({ itemId });
}
