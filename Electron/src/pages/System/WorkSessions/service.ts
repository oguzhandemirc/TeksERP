import apiClient from "@/services/apiClient";
import type { ApiResponse, PaginatedResponse } from "@/types/api";
import type { WorkSessionItem } from "./types";

const BASE = "/api/work-sessions";

export interface WorkSessionHistoryParams {
  userId?: string;
  machineId?: string;
  stationId?: string;
  /** ISO tarih (gün başı/sonu çağıran ayarlar). */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const workSessionService = {
  /** Canlı panel — tüm aktif oturumlar (backend okuma anında tembel idle süpürmesi yapar). */
  listActive: (): Promise<ApiResponse<WorkSessionItem[]>> =>
    apiClient.get<ApiResponse<WorkSessionItem[]>>(`${BASE}/active`).then((r) => r.data),

  /** Geçmiş (ayak izi) — kullanıcı/makine/istasyon/tarih filtreli, offset sayfalı. */
  history: (params: WorkSessionHistoryParams): Promise<PaginatedResponse<WorkSessionItem>> =>
    apiClient
      .get<PaginatedResponse<WorkSessionItem>>(BASE, { params })
      .then((r) => r.data),

  /** Oturumu zorla kapat (ADMIN) — sahadaki cihaz bir sonraki işlemde yeniden yer onayı ister. */
  forceClose: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${id}/force-close`).then((r) => r.data),
};
