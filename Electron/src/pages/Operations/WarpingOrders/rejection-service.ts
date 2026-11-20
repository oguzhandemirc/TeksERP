// =============================================================================
// FASON DEVERE — kusurlu sarım ret belgesi API istemcisi · `/api/warping-beam-rejections` (devere ek C2)
// =============================================================================
// Önizleme yazmaz ve yalnız kullanıcı "Önizle"ye basınca gider (otomatik POST değil). Ret `clientToken` ile MANTIKSAL
// DENEME başına; fotoğraflar ret isteğinde base64 (sunucu sihirli bayttan JPEG/PNG denetler, ≤5 MB/foto).
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import { WARPING_ORDERS_QUERY_KEY } from "./service";
import type {
  RejectPhotoInput, WarpingBeamRejection, WarpingBeamRejectionCancelPreview, WarpingBeamRejectionFields, WarpingBeamRejectionPage, WarpingBeamRejectionPreview,
} from "./rejection-types";

const BASE = "/api/warping-beam-rejections";

export const warpingRejectionService = {
  preview: (body: WarpingBeamRejectionFields & { photoCount: number }) =>
    apiClient.post<ApiResponse<WarpingBeamRejectionPreview>>(`${BASE}/preview`, body).then((r) => r.data.data),
  create: (body: WarpingBeamRejectionFields & { clientToken: string; photos: RejectPhotoInput[] }) =>
    apiClient.post<ApiResponse<WarpingBeamRejection>>(BASE, body).then((r) => r.data),
  /** Siparişin bütün ret belgeleri (iptaller dahil, yeniden eskiye). Bir siparişte ret belgesi az olur — tek sayfa yeter. */
  listForOrder: (orderId: string) =>
    apiClient.get<{ success: boolean } & WarpingBeamRejectionPage>(`${BASE}?filter[warpingOrderId]=${encodeURIComponent(orderId)}&limit=200`).then((r) => r.data),
  get: (id: string) => apiClient.get<ApiResponse<WarpingBeamRejection>>(`${BASE}/${id}`).then((r) => r.data.data),
  photoBlob: (id: string, photoId: string) => apiClient.get<Blob>(`${BASE}/${id}/photos/${photoId}`, { responseType: "blob" }).then((r) => r.data),
  cancelPreview: (id: string) => apiClient.get<ApiResponse<WarpingBeamRejectionCancelPreview>>(`${BASE}/${id}/cancel-preview`).then((r) => r.data.data),
  cancel: (id: string, reason: string) => apiClient.post<ApiResponse<WarpingBeamRejection>>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data),
};

export function useWarpingRejections(orderId: string) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "rejections", orderId], queryFn: () => warpingRejectionService.listForOrder(orderId) });
}
