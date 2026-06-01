import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { BalanceSpec } from "./types";

export const productBalanceService = {
  /** Spec başına üretim dengesi (MRP net ihtiyaç). */
  getBalance: (): Promise<ApiResponse<BalanceSpec[]>> =>
    apiClient
      .get<ApiResponse<BalanceSpec[]>>("/api/production-balance")
      .then((r) => r.data),
};
