// =============================================================================
// FASON DEVERE — iplik sevki · sevk iptali · çözgü talimatı API istemcisi (D6b)
// =============================================================================
// Önizlemeler GET'tir (yazmaz); sevk `clientToken` ile MANTIKSAL DENEME başına (diyalog `useAttemptToken`).
// Sevk yanıtının `warnings`i apiClient interceptor'ında BİR KEZ basılır — formda ikinci toast yok.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingDispatchBody, WarpingDispatchCancelPreview, WarpingDispatchPreview, WarpingDispatchRow, WarpingInstruction } from "./yarn-types";

const BASE = "/api/warping-orders";

export const warpingYarnService = {
  dispatches: (id: string) => apiClient.get<ApiResponse<WarpingDispatchRow[]>>(`${BASE}/${id}/dispatches`).then((r) => r.data.data),
  dispatchPreview: (id: string) => apiClient.get<ApiResponse<WarpingDispatchPreview>>(`${BASE}/${id}/dispatch-preview`).then((r) => r.data.data),
  dispatch: (id: string, body: WarpingDispatchBody) =>
    apiClient.post<ApiResponse<{ dispatch: { id: string; dispatchNo: string } }>>(`${BASE}/${id}/dispatch`, body).then((r) => r.data),
  dispatchCancelPreview: (id: string, dispatchId: string) =>
    apiClient.get<ApiResponse<WarpingDispatchCancelPreview>>(`${BASE}/${id}/dispatches/${dispatchId}/cancel-preview`).then((r) => r.data.data),
  cancelDispatch: (id: string, dispatchId: string, reason: string) =>
    apiClient.post<ApiResponse<{ dispatchNo: string }>>(`${BASE}/${id}/dispatches/${dispatchId}/cancel`, { reason }).then((r) => r.data),
  instruction: (id: string) => apiClient.get<ApiResponse<WarpingInstruction>>(`${BASE}/${id}/instruction`).then((r) => r.data.data),
};

export function useWarpingDispatches(id: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "dispatches", id], queryFn: () => warpingYarnService.dispatches(id) });
}

export function useWarpingInstruction(id: string, enabled: boolean) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "instruction", id], queryFn: () => warpingYarnService.instruction(id), enabled, staleTime: 0 });
}
