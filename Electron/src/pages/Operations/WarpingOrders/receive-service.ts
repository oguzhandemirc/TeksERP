// =============================================================================
// FASON DEVERE — levent kabulü · kabuller · kabul geri alma API istemcisi (D7a)
// =============================================================================
// Önizleme yazmaz (kullanıcı "Önizle"ye basınca); kabul `clientToken` ile MANTIKSAL DENEME başına (`useAttemptToken`).
// Kabul yanıtının `warnings`i apiClient interceptor'ında BİR KEZ basılır — diyalogda ikinci toast yok.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type { WarpingReceipt, WarpingReceiptCancelPreview, WarpingReceipts, WarpingReceiveFields, WarpingReceivePreview } from "./receive-types";

const BASE = "/api/warping-orders";

export const warpingReceiveService = {
  receipts: (id: string) => apiClient.get<ApiResponse<WarpingReceipts>>(`${BASE}/${id}/receipts`).then((r) => r.data.data),
  receivePreview: (id: string, body: WarpingReceiveFields) =>
    apiClient.post<ApiResponse<WarpingReceivePreview>>(`${BASE}/${id}/receive/preview`, body).then((r) => r.data.data),
  receive: (id: string, body: WarpingReceiveFields & { clientToken: string }) =>
    apiClient.post<ApiResponse<WarpingReceipt>>(`${BASE}/${id}/receive`, body).then((r) => r.data),
  cancelPreview: (id: string, receiptKey: string) =>
    apiClient.get<ApiResponse<WarpingReceiptCancelPreview>>(`${BASE}/${id}/receipts/${receiptKey}/cancel-preview`).then((r) => r.data.data),
  cancel: (id: string, receiptKey: string, reason: string) =>
    apiClient.post<ApiResponse<{ cancelledBeams: unknown[] }>>(`${BASE}/${id}/receipts/${receiptKey}/cancel`, { reason }).then((r) => r.data),
};

export function useWarpingReceipts(id: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "receipts", id], queryFn: () => warpingReceiveService.receipts(id) });
}
