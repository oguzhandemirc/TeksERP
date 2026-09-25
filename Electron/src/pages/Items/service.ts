import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";
import type { ItemLifecyclePreview, ItemLifecycleStatus } from "@/lib/item-lifecycle";
import type { Item, ItemColorLink, ItemPropertyLink } from "./types";

const baseService = createCrudService<Item>("/api/items");

export const itemService = {
  ...baseService,
  /** Tek bir rengi kumaşın izinli listesine ekle. Idempotent. */
  addAllowedColor: (itemId: string, colorId: string) =>
    apiClient
      .post<ApiResponse<ItemColorLink>>(`/api/items/${itemId}/allowed-colors`, { colorId })
      .then((r) => r.data),
  /** Tek bir özelliği kumaşın izinli listesine ekle. Idempotent. */
  addAllowedProperty: (itemId: string, propertyId: string) =>
    apiClient
      .post<ApiResponse<ItemPropertyLink>>(`/api/items/${itemId}/allowed-properties`, { propertyId })
      .then((r) => r.data),
  /** Geçiş önizlemesi — canlı kayıtlar tek tek (URUN-YASAM-DONGUSU §5). */
  lifecyclePreview: (itemId: string, to: ItemLifecycleStatus) =>
    apiClient
      .get<ApiResponse<ItemLifecyclePreview>>(`/api/items/${itemId}/lifecycle-preview`, { params: { to } })
      .then((r) => r.data),
  /** Durum geçişi. Arşiv 409'unun kayıt listesi genel diyalogda (`live-references`). */
  transitionLifecycle: (itemId: string, to: ItemLifecycleStatus, reason: string | null) =>
    apiClient
      .post<ApiResponse<Item>>(`/api/items/${itemId}/lifecycle`, { to, reason })
      .then((r) => r.data),
  /** Liste rozeti: kart başına kalan canlı kayıt. */
  lifecycleSummary: (ids: string[]) =>
    apiClient
      .get<ApiResponse<Array<{ id: string; liveTotal: number; rolls: number }>>>("/api/items/lifecycle-summary", {
        params: { ids: ids.join(",") },
      })
      .then((r) => r.data),
};
