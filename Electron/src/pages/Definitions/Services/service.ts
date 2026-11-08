// Hizmet kartı uçları (`/api/service-items`, D1b) — ürün kartından ayrı tablo; izin aynı (`item:read` / `item:write`).
// Yaşam döngüsü uçları ürün kartıyla aynı şekli konuşur → `ItemLifecycleDialog`/`ItemLifecycleBadge` bu nesneyle çalışır.
import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";
import type { CardLifecycleApi, ItemLifecyclePreview, ItemLifecycleStatus } from "@/lib/item-lifecycle";
import type { ServiceItem } from "./types";

const BASE = "/api/service-items";

export const serviceItemService = createCrudService<ServiceItem>(BASE);

export const serviceItemLifecycleApi: CardLifecycleApi = {
  queryRoot: "service-items",
  lifecyclePreview: (id: string, to: ItemLifecycleStatus) =>
    apiClient.get<ApiResponse<ItemLifecyclePreview>>(`${BASE}/${id}/lifecycle-preview`, { params: { to } }).then((r) => r.data),
  transitionLifecycle: (id: string, to: ItemLifecycleStatus, reason: string | null) =>
    apiClient.post<ApiResponse<ServiceItem>>(`${BASE}/${id}/lifecycle`, { to, reason }).then((r) => r.data),
  lifecycleSummary: (ids: string[]) =>
    apiClient
      .get<ApiResponse<Array<{ id: string; liveTotal: number; rolls: number }>>>(`${BASE}/lifecycle-summary`, { params: { ids: ids.join(",") } })
      .then((r) => r.data),
};
