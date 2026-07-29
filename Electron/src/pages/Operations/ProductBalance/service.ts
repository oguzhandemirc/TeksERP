import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { BalanceGroup } from "./types";

export const productBalanceService = {
  /**
   * (kumaş+renk) grubu başına üretim dengesi (MRP net ihtiyaç). Ham + malzeme
   * açığı grup düzeyinde; en kırılımı her grubun specs[]'inde.
   * @param params.itemId Verilirse backend dengeyi yalnız bu kumaş için hesaplar
   *   (arz/talep/üretim sorguları daraltılır). Renk/durum/arama client-side.
   */
  getBalance: (params?: {
    itemId?: string;
  }): Promise<ApiResponse<BalanceGroup[]>> => {
    const qs = params?.itemId
      ? `?itemId=${encodeURIComponent(params.itemId)}`
      : "";
    return apiClient
      .get<ApiResponse<BalanceGroup[]>>(`/api/production-balance${qs}`)
      .then((r) => r.data);
  },
};
