import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import type { ApiResponse } from "@/types/api";
import type { Order } from "./types";

const base = createCrudService<Order>("/api/orders");

export const orderService = {
  ...base,
  manualClose: (id: string, reason: string): Promise<ApiResponse<Order>> =>
    apiClient
      .post<ApiResponse<Order>>(`/api/orders/${id}/manual-close`, { reason })
      .then((r) => r.data),
};
