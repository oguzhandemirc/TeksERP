import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { ItemLifecycleStatus } from "@/lib/item-lifecycle";

export type { ColorNameScope } from "@/services/labelService";

export interface CustomerItemAlias {
  id: string;
  customerId: string;
  itemId: string;
  alias: string;
  item?: { id: string; code: string; name: string };
}

export interface CustomerColorAlias {
  id: string;
  customerId: string;
  colorId: string;
  /** Müşterideki özel ad — opsiyonel. Null = özel ad verilmemiş. */
  alias: string | null;
  /** Renk bu müşteriye "özel renk" olarak atandı mı? alias'tan bağımsız. */
  assigned: boolean;
  color?: { id: string; code: string; name: string; hex: string | null; isActive: boolean };
}

/** Müşterinin YALNIZ BİR KUMAŞTAKİ renk adı (müşteri + kumaş + renk); genel addan önce gelir. */
export interface CustomerItemColorAlias {
  id: string;
  customerId: string;
  itemId: string;
  colorId: string;
  /** Müşterinin BU kumaştaki renk adı — zorunlu (satır yalnız ad taşır). */
  alias: string;
  createdAt: string;
  updatedAt: string;
  item?: { id: string; code: string; name: string; lifecycleStatus: ItemLifecycleStatus };
  color?: { id: string; code: string; name: string; hex: string | null; isActive: boolean };
  customer?: { id: string; code: string; name: string; isActive: boolean };
}

export const customerAliasService = {
  listItemAliases: (customerId: string): Promise<ApiResponse<CustomerItemAlias[]>> =>
    apiClient
      .get<ApiResponse<CustomerItemAlias[]>>(
        `/api/customers/${customerId}/item-aliases`,
      )
      .then((r) => r.data),

  upsertItemAlias: (
    customerId: string,
    itemId: string,
    alias: string,
  ): Promise<ApiResponse<CustomerItemAlias>> =>
    apiClient
      .put<ApiResponse<CustomerItemAlias>>(
        `/api/customers/${customerId}/item-aliases/${itemId}`,
        { alias },
      )
      .then((r) => r.data),

  deleteItemAlias: (customerId: string, itemId: string): Promise<ApiResponse<void>> =>
    apiClient
      .delete<ApiResponse<void>>(
        `/api/customers/${customerId}/item-aliases/${itemId}`,
      )
      .then((r) => r.data),

  listColorAliases: (customerId: string): Promise<ApiResponse<CustomerColorAlias[]>> =>
    apiClient
      .get<ApiResponse<CustomerColorAlias[]>>(
        `/api/customers/${customerId}/color-aliases`,
      )
      .then((r) => r.data),

  upsertColorAlias: (
    customerId: string,
    colorId: string,
    alias: string,
  ): Promise<ApiResponse<CustomerColorAlias>> =>
    apiClient
      .put<ApiResponse<CustomerColorAlias>>(
        `/api/customers/${customerId}/color-aliases/${colorId}`,
        { alias },
      )
      .then((r) => r.data),

  deleteColorAlias: (customerId: string, colorId: string): Promise<ApiResponse<void>> =>
    apiClient
      .delete<ApiResponse<void>>(
        `/api/customers/${customerId}/color-aliases/${colorId}`,
      )
      .then((r) => r.data),

  listItemColorAliases: (customerId: string): Promise<ApiResponse<CustomerItemColorAlias[]>> =>
    apiClient
      .get<ApiResponse<CustomerItemColorAlias[]>>(`/api/customers/${customerId}/item-color-aliases`)
      .then((r) => r.data),

  listItemColorAliasesByItem: (itemId: string): Promise<ApiResponse<CustomerItemColorAlias[]>> =>
    apiClient
      .get<ApiResponse<CustomerItemColorAlias[]>>(`/api/items/${itemId}/customer-color-aliases`)
      .then((r) => r.data),

  upsertItemColorAlias: (
    customerId: string,
    itemId: string,
    colorId: string,
    alias: string,
  ): Promise<ApiResponse<CustomerItemColorAlias>> =>
    apiClient
      .put<ApiResponse<CustomerItemColorAlias>>(
        `/api/customers/${customerId}/item-color-aliases/${itemId}/${colorId}`,
        { alias },
      )
      .then((r) => r.data),

  deleteItemColorAlias: (
    customerId: string,
    itemId: string,
    colorId: string,
  ): Promise<ApiResponse<{ deleted: true }>> =>
    apiClient
      .delete<ApiResponse<{ deleted: true }>>(
        `/api/customers/${customerId}/item-color-aliases/${itemId}/${colorId}`,
      )
      .then((r) => r.data),
};
