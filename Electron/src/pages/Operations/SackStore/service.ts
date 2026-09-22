import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DispatchPayload, SackStoreListParams, SackStoreListResponse, ShipmentContents } from "./types";

/**
 * Sevk Kapısı servisi — havuzdan kurulmuş PLANNED (çıkış bekleyen) sevkler ve
 * sevk çıkışı (dispatch). Liste HAFİF + cursor sayfalı + sunucu-aramalı (rulo
 * içermez); çuval+rulo dökümü karta tıklayınca `shipmentContents` ile lazy gelir.
 * apiClient interceptor hata mesajını zaten toast'lar (mutation onError yok).
 */
export const sackStoreService = {
  /** Board listesi — sunucu arama (sevk no/müşteri/çuval kodu) + cursor sayfalama. */
  list: (params: SackStoreListParams = {}): Promise<SackStoreListResponse> => {
    const sp = new URLSearchParams();
    if (params.status) sp.set("status", params.status);
    if (params.search) sp.set("search", params.search);
    if (params.destination) sp.set("destination", params.destination);
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

  /** PLANNED sevkiyattan çuvalı çıkar → çuval havuzuna geri döner. */
  removeSack: (shipmentId: string, sackId: string): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${shipmentId}/remove-sack`, { sackId })
      .then((r) => r.data),

  /** Sevk çıkışı ("Sevk Et" / "Alındı") — taşıma bilgileri opsiyonel. */
  dispatch: (id: string, payload: DispatchPayload = {}): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/api/shipping/shipments/${id}/dispatch`, payload)
      .then((r) => r.data),

  /** Saha #19: yurtiçi/yurtdışı kapsamı değiştir. */
  /** `chosen`: operatör ilk-seçimde açıkça seçti — sunucu karta yalnız o zaman yazar. */
  setDestination: (id: string, destination: "DOMESTIC" | "EXPORT", chosen = false): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/destination`, {
        destination,
        ...(chosen ? { destinationChosen: true } : {}),
      })
      .then((r) => r.data),

  /** Saha #21: prosedür/ihracat kodu güncelle (boş = temizle). */
  setProcedureCode: (id: string, procedureCode: string | null): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/shipping/shipments/${id}/procedure-code`, { procedureCode })
      .then((r) => r.data),
};
