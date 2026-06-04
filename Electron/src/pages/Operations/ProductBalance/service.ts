import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { BalanceSpec } from "./types";

export const productBalanceService = {
  /**
   * Spec başına üretim dengesi (MRP net ihtiyaç).
   * @param params.itemId Verilirse backend dengeyi yalnız bu ürün için hesaplar
   *   (arz/talep/üretim sorguları daraltılır). Renk/durum/arama client-side.
   */
  getBalance: (params?: {
    itemId?: string;
  }): Promise<ApiResponse<BalanceSpec[]>> => {
    const qs = params?.itemId
      ? `?itemId=${encodeURIComponent(params.itemId)}`
      : "";
    return apiClient
      .get<ApiResponse<BalanceSpec[]>>(`/api/production-balance${qs}`)
      .then((r) => r.data);
  },
};
