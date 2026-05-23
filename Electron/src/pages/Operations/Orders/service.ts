import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";
import type { Order } from "./types";

const base = createCrudService<Order>("/api/orders");

export interface AliasSuggestResponse {
  itemAlias: string | null;
  colorAlias: string | null;
}

export const orderService = {
  ...base,
  manualClose: (id: string, reason: string): Promise<ApiResponse<Order>> =>
    apiClient
      .post<ApiResponse<Order>>(`/api/orders/${id}/manual-close`, { reason })
      .then((r) => r.data),

  suggestAliases: (
    customerId: string,
    itemId: string,
    colorId?: string | null,
  ): Promise<ApiResponse<AliasSuggestResponse>> => {
    const params = new URLSearchParams({ itemId });
    if (colorId) params.set("colorId", colorId);
    return apiClient
      .get<ApiResponse<AliasSuggestResponse>>(
        `/api/customers/${customerId}/aliases/suggest?${params.toString()}`,
      )
      .then((r) => r.data);
  },
};
