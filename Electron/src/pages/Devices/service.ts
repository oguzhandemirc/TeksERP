import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { DeviceListItem } from "./types";

const BASE = "/api/admin/devices";

export const deviceService = {
  list: (): Promise<ApiResponse<DeviceListItem[]>> =>
    apiClient.get<ApiResponse<DeviceListItem[]>>(BASE).then((r) => r.data),

  /** Cihazı onayla + (opsiyonel) makineye ata + tür (Tablet/Telefon/PC). */
  approve: (id: string, machineId: string | null, kind?: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/approve`, { machineId, ...(kind ? { kind } : {}) })
      .then((r) => r.data),

  /** Cihaza donanım (yazıcı/okuyucu) ata — peripheralIds = bu cihazın kullandığı donanım. */
  assignHardware: (id: string, peripheralIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`${BASE}/${id}/assign-hardware`, { peripheralIds })
      .then((r) => r.data),

  /** Onayı/atamayı geri al (→ PENDING). */
  revoke: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient.post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/revoke`).then((r) => r.data),

  rename: (id: string, name: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .patch<ApiResponse<DeviceListItem>>(`${BASE}/${id}`, { name })
      .then((r) => r.data),

  deactivate: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient.delete<ApiResponse<DeviceListItem>>(`${BASE}/${id}`).then((r) => r.data),

  reactivate: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/reactivate`)
      .then((r) => r.data),

  hardDelete: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .delete<ApiResponse<{ id: string }>>(`${BASE}/${id}/permanent`)
      .then((r) => r.data),
};
