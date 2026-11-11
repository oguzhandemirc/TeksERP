import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { PanoDonem, PanoHareketler, PanoSummary } from "./pano/types";

export interface StationLiveState {
  id: string;
  code: string;
  name: string;
  kind: string;
  type: string;
  queueCount: number;
  activeCount: number;
  todayCompletedCount: number;
  /** EXTERNAL istasyonlarda bugün sevk edilen parça sayısı. INTERNAL'de 0. */
  todayDispatchedCount: number;
}

export async function fetchStationLiveState(): Promise<StationLiveState[]> {
  const res = await apiClient.get<ApiResponse<StationLiveState[]>>(
    "/api/dashboard/stations/live-state",
  );
  return res.data.data;
}

/** Açılış panosu özeti — kapalı/izinsiz kutu `null` gelir (backend `pano.service.ts`). */
export async function fetchPano(donem: PanoDonem): Promise<PanoSummary> {
  const res = await apiClient.get<ApiResponse<PanoSummary>>("/api/dashboard/pano", { params: { donem } });
  return res.data.data;
}

/** Son hareketler — dönemden bağımsız (son 8 kayıt). */
export async function fetchPanoHareketler(): Promise<PanoHareketler> {
  const res = await apiClient.get<ApiResponse<PanoHareketler>>("/api/dashboard/pano/hareketler");
  return res.data.data;
}
