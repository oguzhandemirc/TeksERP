import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  StationCapabilityDetail,
  StationCapabilitySummary,
  StationPropertyMode,
} from "./types";

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
   *
   * 2026-08-10: her satır bir MOD taşır (AUTO/OPTIONAL/REQUIRED). Mod
   * gönderilmezse backend mevcut satırın modunu KORUR, yeni satır OPTIONAL doğar.
   */
  setCapabilities: (
    stationId: string,
    properties: { propertyId: string; mode?: StationPropertyMode }[],
  ): Promise<ApiResponse<StationCapabilityDetail>> =>
    apiClient
      .put<ApiResponse<StationCapabilityDetail>>(`/api/station-capabilities/${stationId}`, {
        properties,
      })
      .then((r) => r.data),
};
