// =============================================================================
// FASON DEVERE — deverecide tutulan iplik · iade · siparişler arası aktarma API istemcisi (D6b-2)
// =============================================================================
// İade (+fire) ve aktarma `clientToken` ile MANTIKSAL DENEME başına; iade önizlemesinin uyarıları yalnız `data` içinde gelir.
// Önizleme/yazım yanıtlarının `warnings`i apiClient interceptor'ında BİR KEZ basılır — diyalogda ikinci gösterim yok.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type {
  WarpingTransferBatch, WarpingTransferCancelPreview, WarpingTransferFields, WarpingTransferPreview, WarpingYarnHolding, WarpingYarnReturnBody, WarpingYarnReturnPreview,
  WarpingYarnReturnPreviewBody, WarpingYarnReturnResult, WarpingYarnReturnRow,
} from "./holding-types";

const BASE = "/api/warping-orders";

export const warpingHoldingService = {
  holdings: (id: string) => apiClient.get<ApiResponse<WarpingYarnHolding[]>>(`${BASE}/${id}/yarn-holdings`).then((r) => r.data.data),
  returns: (id: string) => apiClient.get<ApiResponse<WarpingYarnReturnRow[]>>(`${BASE}/${id}/yarn-returns`).then((r) => r.data.data),
  returnYarn: (id: string, body: WarpingYarnReturnBody) =>
    apiClient.post<ApiResponse<WarpingYarnReturnResult>>(`${BASE}/${id}/yarn-returns`, body).then((r) => r.data),
  returnPreview: (id: string, body: WarpingYarnReturnPreviewBody) =>
    apiClient.post<ApiResponse<WarpingYarnReturnPreview>>(`${BASE}/${id}/yarn-returns/preview`, body).then((r) => r.data.data),
  cancelReturn: (id: string, movementId: string, reason: string) =>
    apiClient.post<ApiResponse<{ itemCode: string }>>(`${BASE}/${id}/yarn-returns/${movementId}/cancel`, { reason }).then((r) => r.data),
  transfers: (id: string) => apiClient.get<ApiResponse<WarpingTransferBatch[]>>(`${BASE}/${id}/yarn-transfers`).then((r) => r.data.data),
  transferPreview: (id: string, body: WarpingTransferFields) =>
    apiClient.post<ApiResponse<WarpingTransferPreview>>(`${BASE}/${id}/yarn-transfers/preview`, body).then((r) => r.data.data),
  transfer: (id: string, body: WarpingTransferFields & { clientToken: string }) =>
    apiClient.post<ApiResponse<WarpingTransferBatch>>(`${BASE}/${id}/yarn-transfers`, body).then((r) => r.data),
  transferCancelPreview: (id: string, batchId: string) =>
    apiClient.get<ApiResponse<WarpingTransferCancelPreview>>(`${BASE}/${id}/yarn-transfers/${batchId}/cancel-preview`).then((r) => r.data.data),
  transferCancel: (id: string, batchId: string, reason: string) =>
    apiClient.post<ApiResponse<{ totalKg: string }>>(`${BASE}/${id}/yarn-transfers/${batchId}/cancel`, { reason }).then((r) => r.data),
};

export function useWarpingHoldings(id: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "yarn-holdings", id], queryFn: () => warpingHoldingService.holdings(id) });
}

export function useWarpingReturns(id: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "yarn-returns", id], queryFn: () => warpingHoldingService.returns(id) });
}

export function useWarpingTransfers(id: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "yarn-transfers", id], queryFn: () => warpingHoldingService.transfers(id) });
}
