import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  KursunBulkAssignResult,
  KursunBulkCancelResult,
  KursunBypassAssignResult,
  KursunBypassCancelResult,
  KursunBypassCompletePreview,
  KursunBypassCompleteResult,
  KursunDistributionPayload,
  KursunQueueUrgentResult,
} from "./types";

const BASE = "/api/kursun-bypass";

export const kursunDagitimService = {
  // `GET /visibility` (menü sayaçları) 2026-08-05'te KALDIRILDI: Kurşun Sırası +
  // Kurşun Dağıtım "Kurşun Planlama"da birleşti ve karo bayrak/sayaçtan bağımsız
  // hale geldi (yalnız izinle süzülüyor) → onu tüketen `useKursunVisibility`
  // hook'u ile birlikte silindi. Backend ucu duruyor (eski APK uyumluluğu).

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

  /**
   * TOPLU dağıtım / makineler arası TOPLU taşıma — ikisi de aynı uç
   * (`assign` yeniden-atamayı taşıma olarak ele alır).
   *
   * ⚠️ Sonuç PARÇALI olabilir: `failed` boş değilse bazı satırlar atlanmıştır.
   * Çağıran onları GÖSTERMEK zorunda (`useKursunDistribution.reportBulk`).
   */
  assignBulk: (input: {
    workOrderIds: string[];
    machineId: string;
    notes?: string;
  }): Promise<ApiResponse<KursunBulkAssignResult>> =>
    apiClient
      .post<ApiResponse<KursunBulkAssignResult>>(`${BASE}/assign-bulk`, input)
      .then((r) => r.data),

  /** Seçilenleri TOPLUCA havuza döndürür. `assignBulk` ile aynı parçalı sözleşme. */
  cancelBulk: (input: {
    assignmentIds: string[];
    reason?: string;
  }): Promise<ApiResponse<KursunBulkCancelResult>> =>
    apiClient
      .post<ApiResponse<KursunBulkCancelResult>>(`${BASE}/cancel-bulk`, input)
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

  /**
   * SIRALAMA — `urgent` ile aynı kurşun kuyruğu ucu. Ayrı bir bypass ucu YOK:
   * sıralanan alan `WorkOrderStep.priority` ve onu kurşun tabletinin `open-cards`
   * listesi de okuyor; ikinci bir yazma yolu iki sıralama doğururdu.
   *
   * Gövde YALNIZ bekleyen (dağıtılmamış) satırları taşır — dağıtılmış iş artık
   * kuyrukta değil, makinede. Backend zaten yalnız açık PROCESS_QC adımlarını
   * günceller; kapsam daralması burada BİLİNÇLİ (bkz. `reorderWaiting`).
   */
  reorder: (
    items: { id: string; priority: number }[],
  ): Promise<ApiResponse<{ updated: number }>> =>
    apiClient
      .patch<ApiResponse<{ updated: number }>>("/api/kursun-qc/queue/reorder", {
        items,
      })
      .then((r) => r.data),
};
