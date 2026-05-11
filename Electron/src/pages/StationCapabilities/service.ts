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

  setCapabilities: (
    stationId: string,
    colorIds: string[],
    propertyIds: string[],
  ): Promise<ApiResponse<StationCapabilityDetail>> =>
    apiClient
      .put<ApiResponse<StationCapabilityDetail>>(`/api/station-capabilities/${stationId}`, {
        colorIds,
        propertyIds,
      })
      .then((r) => r.data),
};
