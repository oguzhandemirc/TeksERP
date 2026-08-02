import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  KursunBypassAssignResult,
  KursunBypassCancelResult,
  KursunBypassCompletePreview,
  KursunBypassCompleteResult,
  KursunBypassVisibility,
  KursunDistributionPayload,
  KursunQueueUrgentResult,
} from "./types";

const BASE = "/api/kursun-bypass";

export const kursunDagitimService = {
  /**
   * MENÜ ÇİZME ucu — üç sayı, ağır `distribution` payload'ı yok. İki KARO'nun
   * (Kurşun Sırası + Kurşun Dağıtım) görünürlüğü buna bağlı, o yüzden bu ekranın
   * değil `useKursunVisibility` hook'unun tükettiği bir uçtur; API yüzeyi aynı
   * `/api/kursun-bypass` olduğu için servis burada durur.
   *
   * `suppressErrorToast`: menü çizerken koşan arka plan isteği — 403/500 hâlinde
   * kullanıcıya toast atmak anlamsız (kimse bir şey istemedi); hook sayaçları 0
   * kabul eder ve davranış saf bayrak kuralına düşer.
   */
  getVisibility: (): Promise<ApiResponse<KursunBypassVisibility>> =>
    apiClient
      .get<ApiResponse<KursunBypassVisibility>>(`${BASE}/visibility`, {
        suppressErrorToast: true,
      })
      .then((r) => r.data),

  /** Ekranın TEK payload'ı: bayrak + makineler + bekleyen + dağıtılmış. */
  getDistribution: (): Promise<ApiResponse<KursunDistributionPayload>> =>
    apiClient
      .get<ApiResponse<KursunDistributionPayload>>(`${BASE}/distribution`)
      .then((r) => r.data),

  /** Hedef fiziksel kurşun MAKİNESİDİR (istasyon değil) — backend `machineId` bekler. */
  assign: (input: {
    workOrderId: string;
    machineId: string;
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
