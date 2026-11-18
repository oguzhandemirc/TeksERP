// =============================================================================
// FASON DEVERE — kapanış · kapanış geçmişi · yeniden açma API istemcisi (D7b)
// =============================================================================
// Önizlemeler yazmaz; kapanış `clientToken` ile MANTIKSAL DENEME başına (`useAttemptToken`). Yanıtların `warnings`i
// apiClient interceptor'ında BİR KEZ basılır — diyalogda ikinci toast yok (önizleme uyarıları `data.warnings`te, diyalog çizer).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingReopenPreview, WarpingSettleFields, WarpingSettlePreview, WarpingSettlementRecord } from "./settle-types";

const BASE = "/api/warping-orders";

export const warpingSettleService = {
  defaultPreview: (id: string) => apiClient.get<ApiResponse<WarpingSettlePreview>>(`${BASE}/${id}/settlement-preview`).then((r) => r.data.data),
  preview: (id: string, body: WarpingSettleFields) =>
    apiClient.post<ApiResponse<WarpingSettlePreview>>(`${BASE}/${id}/settle/preview`, body).then((r) => r.data.data),
  settle: (id: string, body: WarpingSettleFields & { clientToken: string }) =>
    apiClient.post<ApiResponse<WarpingSettlementRecord>>(`${BASE}/${id}/settle`, body).then((r) => r.data),
  settlements: (id: string) => apiClient.get<ApiResponse<WarpingSettlementRecord[]>>(`${BASE}/${id}/settlements`).then((r) => r.data.data),
  reopenPreview: (id: string) => apiClient.get<ApiResponse<WarpingReopenPreview>>(`${BASE}/${id}/reopen-preview`).then((r) => r.data.data),
  reopen: (id: string, reason: string) => apiClient.post<ApiResponse<unknown>>(`${BASE}/${id}/reopen`, { reason }).then((r) => r.data),
};

export function useWarpingSettlements(id: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "settlements", id], queryFn: () => warpingSettleService.settlements(id) });
}
