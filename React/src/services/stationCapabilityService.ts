// =============================================================================
// İstasyon yetkinlik (renk + özellik) servisi
// =============================================================================
// CRUD pattern dışında — bulk get/set semantics. Doğrudan apiClient kullanılır.

import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  StationCapability,
  StationCapabilitySummary,
} from "@/types/models";

export const stationCapabilityService = {
  /** Tüm istasyonların yetkinlik özetini döner. */
  list(): Promise<ApiResponse<StationCapabilitySummary[]>> {
    return apiClient
      .get<ApiResponse<StationCapabilitySummary[]>>("/api/station-capabilities")
      .then((r) => r.data);
  },

  /** Tüm istasyonların DETAYLI yetkinliklerini döner — UI filtreleme için. */
  listDetailed(): Promise<ApiResponse<StationCapability[]>> {
    return apiClient
      .get<ApiResponse<StationCapability[]>>(
        "/api/station-capabilities?detailed=true",
      )
      .then((r) => r.data);
  },

  /** Bir istasyonun renk + özellik yetkinlikleri. */
  getByStation(stationId: string): Promise<ApiResponse<StationCapability>> {
    return apiClient
      .get<ApiResponse<StationCapability>>(
        `/api/station-capabilities/${stationId}`,
      )
      .then((r) => r.data);
  },

  /**
   * İstasyonun renk + özellik yetkinliklerini topluca değiştirir (replace).
   */
  setForStation(
    stationId: string,
    body: { colorIds: string[]; propertyIds: string[] },
  ): Promise<ApiResponse<StationCapability>> {
    return apiClient
      .put<ApiResponse<StationCapability>>(
        `/api/station-capabilities/${stationId}`,
        body,
      )
      .then((r) => r.data);
  },
};
