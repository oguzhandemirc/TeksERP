import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  KursunBypassAssignResult,
  KursunBypassCancelResult,
  KursunBypassCompletePreview,
  KursunBypassCompleteResult,
  KursunDistributionPayload,
  KursunQueueUrgentResult,
} from "./types";

const BASE = "/api/kursun-bypass";

export const kursunDagitimService = {
  /** Ekranın TEK payload'ı: bayrak + istasyonlar + bekleyen + dağıtılmış. */
  getDistribution: (): Promise<ApiResponse<KursunDistributionPayload>> =>
    apiClient
      .get<ApiResponse<KursunDistributionPayload>>(`${BASE}/distribution`)
      .then((r) => r.data),

  assign: (input: {
    workOrderId: string;
    stationId: string;
    notes?: string;
  }): Promise<ApiResponse<KursunBypassAssignResult>> =>
    apiClient
      .post<ApiResponse<KursunBypassAssignResult>>(`${BASE}/assign`, input)
      .then((r) => r.data),

  cancel: (
    assignmentId: string,
    reason?: string,
  ): Promise<ApiResponse<KursunBypassCancelResult>> =>
    apiClient
      .post<
        ApiResponse<KursunBypassCancelResult>
      >(`${BASE}/${assignmentId}/cancel`, reason ? { reason } : {})
      .then((r) => r.data),

  /** Salt okunur — "İşi Bitir" onay ekranının kaynağı. */
  getCompletePreview: (
    assignmentId: string,
  ): Promise<ApiResponse<KursunBypassCompletePreview>> =>
    apiClient
      .get<
        ApiResponse<KursunBypassCompletePreview>
      >(`${BASE}/${assignmentId}/complete-preview`)
      .then((r) => r.data),

  /**
   * SON ADIM yolu. `rollIds` ÖNİZLEMEDEN gelir — backend kapsamı birebir
   * doğrular (arada adıma yeni top girdiyse 409 döner).
   */
  complete: (
    assignmentId: string,
    rollIds: string[],
  ): Promise<ApiResponse<KursunBypassCompleteResult>> =>
    apiClient
      .post<
        ApiResponse<KursunBypassCompleteResult>
      >(`${BASE}/${assignmentId}/complete`, { rollIds })
      .then((r) => r.data),

  /**
   * ACİL işaretleme — kurşun kuyruğunun MEVCUT ucu (`workorder:distribute`
   * bu ucu da kapsıyor). Ayrı bir bypass ucu YOK, kuyruk tek kaynak.
   */
  setUrgent: (
    stepId: string,
    isUrgent: boolean,
  ): Promise<ApiResponse<KursunQueueUrgentResult>> =>
    apiClient
      .patch<
        ApiResponse<KursunQueueUrgentResult>
      >(`/api/kursun-qc/queue/${stepId}/urgent`, { isUrgent })
      .then((r) => r.data),
};
