import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Kurşun Dağıtım (Kurşun Bypass) — mobil servis katmanı.
// Backend: Teks-Erp/src/services/kursun-bypass.service.ts (+ routes/kursun-bypass.routes.ts)
//
// Fabrika kurşun makinelerine TABLET KOYMUYOR: kurşun işlemi fiziksel olarak
// yapılır ama dijital izlenmez (hatalar kâğıtta). Yetkili personel bekleyen iş
// emrini fiziksel bir kurşun MAKİNESİNE ATAR; adım sonradan iki yoldan kapanır:
//   • Tambur tabletinde refakat kartı okutulur → kurşun adımı SESSİZCE kapanır
//     (Tambur operatörü hiçbir şey onaylamaz), ya da
//   • Kurşun rotanın SON adımıysa bu ekrandaki "İşi Bitir" (complete).
//
// ⚠️ ATAMA MAKİNE BAZINDADIR — İSTASYON BAZINDA DEĞİL. Fabrikada PROCESS_QC
// türünde TEK istasyon vardır (KURSUN_KK2) ve altında N adet fiziksel kurşun
// MAKİNESİ durur; dağıtımcının seçtiği şey o makinelerden biridir. Adımın
// `stationId`'si DEĞİŞTİRİLMEZ (istasyon zaten tek); atama bilgisi atama
// satırında yaşar ve üretim atfı kapanan movement'ın `RollMovement.machineId`
// damgasıyla tutulur → makine bazlı hacim raporları çalışır.
//
// ⚠️ Bu SKIPPED DEĞİLDİR — adım atlanmaz, movement'lar normal kapanır ve adım
// COMPLETED olur. Fark: QC2/Kurşun RollOperation'ı yazılmaz, hata kaydı açılmaz.
//
// Tip konvansiyonu: backend payload tipleri BU DOSYADA yaşar (tambur.service.ts
// içindeki TamburUndoPreview emsali). Tarih alanları backend'de `Date`, telde
// ISO string olarak gelir → burada `string`.
//
// Yetki: `workorder:distribute` (web) VEYA `mobile:kursun-dagitim` (mobil ikizi).
// =============================================================================

/**
 * Dağıtım hedefi olabilecek fiziksel kurşun MAKİNESİ — PROCESS_QC istasyonuna
 * bağlı, aktif. Makinenin kendi "kind"i yoktur; tür ve yetenekler bağlı olduğu
 * istasyondan (`stationId`) okunur.
 */
export interface KursunBypassMachineOption {
  id: string;
  code: string;
  name: string;
  /** Makinenin bağlı olduğu istasyon — yetenek okuması bu id üzerinden yapılır. */
  stationId: string;
  stationName: string;
}

/** Bekleyen + dağıtılmış satırların ORTAK gövdesi. */
export interface KursunDistributionRowBase {
  workOrderStepId: string;
  workOrderId: string;
  workOrderNumber: string;
  /** Adımdaki AÇIK topların DISTINCT parti numaraları (partisiz toplar atlanır). */
  batchNumbers: string[];
  travelerCardNumber: string | null;
  travelerCardBarcode: string | null;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  /** Açık topların toplam GÜNCEL metrajı (metre). */
  totalMeters: number;
  /** Adıma ilk topun giriş anı (ISO) — "en eski giriş" rozetinin kaynağı. */
  oldestEnteredAt: string | null;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
  /** Kurşun rotanın son (non-SKIPPED) adımı mı → "İşi Bitir" bu satırda çıkar. */
  isLastStep: boolean;
}

export interface KursunDistributionWaitingRow extends KursunDistributionRowBase {
  /** Bu adım bypass'a dağıtılabilir mi? */
  eligible: boolean;
  /** Uygunluk kurallarından hangisi düştü — somut Türkçe sebep (null = uygun). */
  blockReason: string | null;
}

export interface KursunDistributionAssignedRow extends KursunDistributionRowBase {
  assignmentId: string;
  /** ATANAN fiziksel kurşun makinesi — izleme/gruplama bu alan üzerinden yapılır. */
  machineId: string;
  machineCode: string;
  machineName: string;
  /** Makinenin istasyonu (pratikte hep tek PROCESS_QC istasyonu) — bağlam bilgisi. */
  stationId: string;
  stationName: string;
  assignedAt: string;
  assignedByName: string | null;
  notes: string | null;
  /** Atama artık anlamsız (adım kapandı / açık top kalmadı) → UI iptal önerir. */
  stale: boolean;
  staleReason: string | null;
}

export interface KursunDistributionPayload {
  /** `production.kursunBypassEnabled` — false ise YALNIZ yeni atama kapalıdır. */
  flagEnabled: boolean;
  /** Atama hedefleri: PROCESS_QC istasyonuna bağlı AKTİF kurşun makineleri. */
  machines: KursunBypassMachineOption[];
  waiting: KursunDistributionWaitingRow[];
  assigned: KursunDistributionAssignedRow[];
}

export interface KursunBypassAssignRequest {
  workOrderId: string;
  machineId: string;
  notes?: string | null;
}

export interface KursunBypassAssignResult {
  assignmentId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderStepId: string;
  machineId: string;
  machineName: string;
  /** Makinenin istasyonu — bağlam bilgisi (adımın istasyonu değişmedi). */
  stationId: string;
  stationName: string;
  isLastStep: boolean;
  /** true: zaten dağıtılmıştı, MAKİNE değiştirildi (yeni atama değil). */
  reassigned: boolean;
}

/**
 * İptal yanıtı. "İstasyon geri yüklendi mi" alanı YOK: atama makine bazındadır
 * ve adımın istasyonu atama sırasında hiç değiştirilmedi — geri yüklenecek bir
 * şey de yok. Yalnız atama satırı soft-cancel edilir.
 */
export interface KursunBypassCancelResult {
  assignmentId: string;
  workOrderId: string;
}

export interface KursunBypassPreviewRoll {
  rollId: string;
  barcode: string | null;
  currentQty: number;
}

export interface KursunBypassCompletePreview {
  assignmentId: string;
  workOrderId: string;
  workOrderNumber: string;
  /** İşin ATANDIĞI kurşun makinesi ("hangi makinede yapıldı"). */
  machineName: string;
  /** Makinenin istasyonu — bağlam bilgisi (tek PROCESS_QC istasyonu). */
  stationName: string;
  isLastStep: boolean;
  canComplete: boolean;
  blockReason: string | null;
  rollCount: number;
  totalMeters: number;
  /** "İşi Bitir" onayına gidecek rollIds'in TEK kaynağı — elle liste kurma. */
  rolls: KursunBypassPreviewRoll[];
  willFinalize: {
    targetStatus: 'WAREHOUSE';
    /** Kalite bypass'ta ASLA yazılmaz — "Belirsiz" kalır. */
    qualityStaysNull: true;
    /** Barkodsuz açık kumaşa finalize sırasında üretilecek barkod adedi. */
    barcodesToGenerate: number;
  };
  /** Bu tamamlama iş emrini de KAPATACAK mı (başka açık adım kalmıyorsa). */
  workOrderWillComplete: boolean;
}

export interface KursunBypassCompleteResult {
  /** true: iş zaten bitmişti (idempotent tekrar) — hata değil. */
  alreadyDone: boolean;
  finalizedRollCount: number;
  barcodesGenerated: number;
}

/** PATCH /kursun-qc/queue/:stepId/urgent yanıtı (mevcut kurşun kuyruğu ucu). */
export interface KursunQueueUrgentResult {
  id: string;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
}

export const kursunBypassService = {
  /** Ekranın TEK payload'ı: bayrak + makineler + bekleyenler + dağıtılmışlar. */
  getDistribution: (): Promise<ApiResponse<KursunDistributionPayload>> =>
    apiClient
      .get<ApiResponse<KursunDistributionPayload>>('/kursun-bypass/distribution')
      .then((r) => r.data),

  /** İş emrinin kurşun adımını fiziksel MAKİNEYE dağıt (dağıtılmışsa TAŞI). */
  assign: (
    data: KursunBypassAssignRequest
  ): Promise<ApiResponse<KursunBypassAssignResult>> =>
    apiClient
      .post<ApiResponse<KursunBypassAssignResult>>('/kursun-bypass/assign', data)
      .then((r) => r.data),

  /** Açık dağıtımı iptal et — adım normal tabletli akışa döner. */
  cancel: (
    assignmentId: string,
    data?: { reason?: string | null }
  ): Promise<ApiResponse<KursunBypassCancelResult>> =>
    apiClient
      .post<ApiResponse<KursunBypassCancelResult>>(
        `/kursun-bypass/${assignmentId}/cancel`,
        data ?? {}
      )
      .then((r) => r.data),

  /** "İşi Bitir" öncesi salt-okunur önizleme — hiçbir şeyi değiştirmez. */
  completePreview: (
    assignmentId: string
  ): Promise<ApiResponse<KursunBypassCompletePreview>> =>
    apiClient
      .get<ApiResponse<KursunBypassCompletePreview>>(
        `/kursun-bypass/${assignmentId}/complete-preview`
      )
      .then((r) => r.data),

  /** Kurşun SON adımsa dağıtım ekranından tamamla → toplar WAREHOUSE'a iner. */
  complete: (
    assignmentId: string,
    data: { rollIds: string[] }
  ): Promise<ApiResponse<KursunBypassCompleteResult>> =>
    apiClient
      .post<ApiResponse<KursunBypassCompleteResult>>(
        `/kursun-bypass/${assignmentId}/complete`,
        data
      )
      .then((r) => r.data),

  /** Kuyruk "acil" rozetini aç/kapat. Kurşun kuyruğunun MEVCUT ucu (paylaşımlı). */
  setUrgent: (
    stepId: string,
    isUrgent: boolean
  ): Promise<ApiResponse<KursunQueueUrgentResult>> =>
    apiClient
      .patch<ApiResponse<KursunQueueUrgentResult>>(
        `/kursun-qc/queue/${stepId}/urgent`,
        { isUrgent }
      )
      .then((r) => r.data),
};
