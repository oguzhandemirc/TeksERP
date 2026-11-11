import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { PanoDonem } from "./pano/types";
import type { PanoBoxDef, PanoBoxResponse } from "./pano/box-types";

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

/** Kutu kataloğu — yalnız kullanıcının görebileceği kutular (sıra = varsayılan yerleşim). */
export async function fetchPanoCatalog(): Promise<PanoBoxDef[]> {
  const res = await apiClient.get<ApiResponse<{ kutular: PanoBoxDef[] }>>("/api/dashboard/pano/kutular");
  return res.data.data.kutular;
}

export interface PanoBoxQuery {
  donem: PanoDonem;
  kutular: readonly string[];
  /** Yalnız ajanda içindir (sunucu varsayılanı bugün / bu ay). */
  gun?: string;
  ay?: string;
}

/** Seçili kutular tek istekte; izinsiz/kapalı kutu `null` döner. Hata toast'ı çağıran kutuda gösterilir. */
export async function fetchPanoBoxes(q: PanoBoxQuery): Promise<PanoBoxResponse> {
  const params: Record<string, string> = { donem: q.donem, kutular: q.kutular.join(",") };
  if (q.gun) params.gun = q.gun;
  if (q.ay) params.ay = q.ay;
  const res = await apiClient.get<ApiResponse<PanoBoxResponse>>("/api/dashboard/pano", { params, suppressErrorToast: true });
  return res.data.data;
}
