import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

/** Siparişe yazılamamış bir sevkiyat — onarım adayı. */
export interface RepairableShipment {
  shipmentId: string;
  shipmentNo: string;
  dispatchedAt: string | null;
  customer: { id: string; name: string } | null;
  orderNumbers: string[];
  icerikMetraj: number;
  yazilanMetraj: number;
  /** Çıkan mal − deftere yazılan. */
  bosluk: number;
  /** Bugün yeniden denense yazılabilecek metraj — onarımın beklenen kazancı. */
  onarilabilirMetraj: number;
}

export interface RepairResult {
  shipmentNo: string;
  oncesi: number;
  sonrasi: number;
  kazanc: number;
}

export const allocationRepairService = {
  /** Onarım adayları — sunucu YAZMAZ. */
  list: (): Promise<ApiResponse<RepairableShipment[]>> =>
    apiClient.get<ApiResponse<RepairableShipment[]>>("/api/shipping/repair/allocations").then((r) => r.data),

  /** Tek sevkiyatın defterini onar — irsaliye v+1 doğurur. */
  repair: (shipmentId: string): Promise<ApiResponse<RepairResult>> =>
    apiClient
      .post<ApiResponse<RepairResult>>(`/api/shipping/repair/allocations/${shipmentId}`)
      .then((r) => r.data),
};
