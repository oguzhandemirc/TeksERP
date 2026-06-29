import { createCrudService } from "@/services/crudService";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { PeripheralDevice } from "./types";

export const peripheralService = createCrudService<PeripheralDevice>("/api/peripherals");

/** Bağlantı testi — NETWORK_TCP gerçek/simüle; BT/USB/seri cihaz tarafında. */
export function testPeripheral(id: string): Promise<ApiResponse<{ delivered?: boolean; simulated?: boolean; target?: string; error?: string; note?: string }>> {
  return apiClient.post<ApiResponse<{ delivered?: boolean; simulated?: boolean; target?: string; error?: string; note?: string }>>(
    `/api/peripherals/${id}/test`,
  ).then((r) => r.data);
}
