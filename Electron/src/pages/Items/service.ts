import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";
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
};
