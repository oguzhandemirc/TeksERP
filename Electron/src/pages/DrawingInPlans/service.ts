// Tahar planı uçları (`/api/drawing-in-plans`, `requireDokumaEnabled` + warpspec:read/write).
// Sunucu düz liste döner (cursor yok, tablo küçük): CrudPage/EntityPickerModal'ın beklediği `CrudService`
// biçimine tek sayfalık adaptör. "Pasifleri göster" kapalıyken CrudPage `isActive=true` zorlar → includeInactive yok.
import apiClient from "@/services/apiClient";
import type { CrudService } from "@/services/crudService";
import type { ApiResponse, CursorParams, CursorPaginatedResponse } from "@/types/api";
import type { DrawingInPlan } from "./types";

const BASE = "/api/drawing-in-plans";

function listCursor(p: CursorParams): Promise<CursorPaginatedResponse<DrawingInPlan>> {
  const sp = new URLSearchParams();
  if (p.search) sp.set("search", p.search);
  // Seçici ve kapalı anahtar `isActive: "true"` gönderir; anahtar açıkken filtre düşer → pasifler de gelir.
  if (p.filters?.isActive !== "true") sp.set("includeInactive", "1");
  const qs = sp.toString();
  return apiClient.get<ApiResponse<DrawingInPlan[]>>(qs ? `${BASE}?${qs}` : BASE).then((r) => {
    const data = r.data.data ?? [];
    return { success: true, data, pagination: { nextCursor: null, hasMore: false, limit: data.length } };
  });
}

const notSupported = (): Promise<never> => Promise.reject(new Error("Tahar planı kalıcı silinmez — pasife alın."));

export const drawingInPlanService: CrudService<DrawingInPlan> = {
  getAll: notSupported,
  listCursor,
  getById: (id) => apiClient.get<ApiResponse<DrawingInPlan>>(`${BASE}/${id}`).then((r) => r.data),
  create: (data) => apiClient.post<ApiResponse<DrawingInPlan>>(BASE, data).then((r) => r.data),
  update: (id, data) => apiClient.patch<ApiResponse<DrawingInPlan>>(`${BASE}/${id}`, data).then((r) => r.data),
  remove: (id) => apiClient.delete<ApiResponse<DrawingInPlan>>(`${BASE}/${id}`).then((r) => r.data),
  hardRemove: notSupported,
  // Sunucu `isActive` alanını yazım gövdesinde reddeder; aktif etme ayrı uçtur.
  restore: (id) => apiClient.post<ApiResponse<DrawingInPlan>>(`${BASE}/${id}/activate`).then((r) => r.data),
};
