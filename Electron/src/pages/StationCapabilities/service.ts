import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { StationCapabilityDetail, StationCapabilitySummary } from "./types";

export const stationCapabilityService = {
  list: (): Promise<ApiResponse<StationCapabilitySummary[]>> =>
    apiClient
      .get<ApiResponse<StationCapabilitySummary[]>>("/api/station-capabilities")
      .then((r) => r.data),

  getByStation: (stationId: string): Promise<ApiResponse<StationCapabilityDetail>> =>
    apiClient
      .get<ApiResponse<StationCapabilityDetail>>(`/api/station-capabilities/${stationId}`)
      .then((r) => r.data),

  /**
   * Yalnız ÖZELLİK yetkinliklerini yazar. `colorIds` bilinçli olarak
   * GÖNDERİLMEZ — renk artık istasyon bazlı kısıt değil ve backend alanı
   * opsiyonel karşılar; boş dizi göndermek istasyonun geçmiş renk atamalarını
   * silerdi.
   */
  setCapabilities: (
    stationId: string,
    propertyIds: string[],
  ): Promise<ApiResponse<StationCapabilityDetail>> =>
    apiClient
      .put<ApiResponse<StationCapabilityDetail>>(`/api/station-capabilities/${stationId}`, {
        propertyIds,
      })
      .then((r) => r.data),
};
