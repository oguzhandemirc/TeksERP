import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  DispatchPayload,
  SackStoreListParams,
  SackStoreListResponse,
  ShipmentContents,
} from "./types";

/**
 * Çuval Depo servisi — bağlanan paketli sevkler (READY/AT_DOOR) ve durum
 * geçişleri. Liste HAFİF + cursor sayfalı + sunucu-aramalı (rulo içermez);
 * çuval+rulo dökümü karta tıklayınca `shipmentContents` ile lazy gelir.
 * apiClient interceptor hata mesajını zaten toast'lar (mutation onError yok).
 */
export const sackStoreService = {
  /** Board listesi — sunucu arama (sevk no/müşteri/çuval kodu) + cursor sayfalama. */
  list: (params: SackStoreListParams = {}): Promise<SackStoreListResponse> => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.search) sp.set("search", params.search);
    if (params.cursor) sp.set("cursor", params.cursor);
    if (params.limit) sp.set("limit", String(params.limit));
    const qs = sp.toString();
    return apiClient
      .get<SackStoreListResponse>(`/api/shipping/sack-store/board${qs ? `?${qs}` : ""}`)
      .then((r) => r.data);
  },

  /** Tek sevkiyatın çuval+rulo dökümü (slide-over) — karta tıklayınca lazy. */
  shipmentContents: (shipmentId: string): Promise<ApiResponse<ShipmentContents>> =>
    apiClient
      .get<ApiResponse<ShipmentContents>>(`/api/shipping/shipments/${shipmentId}/sack-contents`)
      .then((r) => r.data),

  /** READY → AT_DOOR ("Kapı Önüne Koy"). */
  moveToDoor: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/api/shipping/shipments/${id}/move-to-door`, {})
      .then((r) => r.data),

  /** AT_DOOR → READY ("Çuval Depoya Geri Çek"). */
  pullBack: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/api/shipping/shipments/${id}/pull-back`, {})
      .then((r) => r.data),

  /** READY → PREPARING ("Hazırlığa Geri Al") — karşılanma geri alınır, içerik düzenlenebilir. */
  unready: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/api/shipping/shipments/${id}/unready`, {})
      .then((r) => r.data),

  /** Sevk çıkışı ("Sevk Et" / "Alındı") — taşıma bilgileri opsiyonel. */
  dispatch: (id: string, payload: DispatchPayload = {}): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/api/shipping/shipments/${id}/dispatch`, payload)
      .then((r) => r.data),
};
