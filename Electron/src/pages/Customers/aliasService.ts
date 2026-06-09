import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

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
};
