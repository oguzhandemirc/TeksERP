import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DeviceListItem, PairingCode } from "./types";

const BASE = "/api/admin/devices";

export const deviceService = {
  list: (): Promise<ApiResponse<DeviceListItem[]>> =>
    apiClient.get<ApiResponse<DeviceListItem[]>>(BASE).then((r) => r.data),

  createPairingCode: (input: {
    machineId: string;
    deviceName: string;
  }): Promise<ApiResponse<PairingCode>> =>
    apiClient
      .post<ApiResponse<PairingCode>>(`${BASE}/pairing-codes`, input)
      .then((r) => r.data),

  rename: (id: string, name: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .patch<ApiResponse<DeviceListItem>>(`${BASE}/${id}`, { name })
      .then((r) => r.data),

  unpair: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/unpair`)
      .then((r) => r.data),

  deactivate: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient.delete<ApiResponse<DeviceListItem>>(`${BASE}/${id}`).then((r) => r.data),
};
