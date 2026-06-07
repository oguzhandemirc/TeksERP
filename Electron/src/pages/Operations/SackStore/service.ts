import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { SackStoreShipment, DispatchPayload } from "./types";

/**
 * Çuval Depo servisi — bağlanan paketli sevkler (READY/AT_DOOR) ve durum
 * geçişleri. Liste tek atışta gelir (sayfasız board); aksiyonlar POST.
 * apiClient interceptor hata mesajını zaten toast'lar (mutation onError yok).
 */
export const sackStoreService = {
  /** Çuval depodaki + kapı önündeki tüm sevkleri çuval/içerik dökümüyle getirir. */
  list: (): Promise<ApiResponse<SackStoreShipment[]>> =>
    apiClient
      .get<ApiResponse<SackStoreShipment[]>>("/api/shipping/sack-store")
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

  /** Sevk çıkışı ("Sevk Et" / "Alındı") — taşıma bilgileri opsiyonel. */
  dispatch: (id: string, payload: DispatchPayload = {}): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string }>>(`/api/shipping/shipments/${id}/dispatch`, payload)
      .then((r) => r.data),
};
