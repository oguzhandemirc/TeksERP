import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Kurşun Dağıtım (Kurşun Bypass) — mobil servis katmanı.
// Backend: Teks-Erp/src/services/kursun-bypass.service.ts (+ routes/kursun-bypass.routes.ts)
//
// Fabrika kurşun istasyonlarına TABLET KOYMUYOR: kurşun işlemi fiziksel olarak
// yapılır ama dijital izlenmez (hatalar kâğıtta). Yetkili personel bekleyen iş
// emrini fiziksel bir kurşun istasyonuna ATAR; adım sonradan iki yoldan kapanır:
//   • Tambur tabletinde refakat kartı okutulur (Tambur ekranının işi), ya da
//   • Kurşun rotanın SON adımıysa bu ekrandaki "İşi Bitir" (complete).
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

/** Dağıtım hedefi olabilecek fiziksel kurşun istasyonu (StationKind.PROCESS_QC). */
export interface KursunBypassStationOption {
  id: string;
  code: string;
  name: string;
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
  stations: KursunBypassStationOption[];
  waiting: KursunDistributionWaitingRow[];
  assigned: KursunDistributionAssignedRow[];
}

export interface KursunBypassAssignRequest {
  workOrderId: string;
  stationId: string;
  notes?: string | null;
}

export interface KursunBypassAssignResult {
  assignmentId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderStepId: string;
  stationId: string;
  stationName: string;
  isLastStep: boolean;
  /** true: zaten dağıtılmıştı, istasyon DEĞİŞTİRİLDİ (yeni atama değil). */
  reassigned: boolean;
}

export interface KursunBypassCancelResult {
  assignmentId: string;
  /** Adımın istasyonu atama öncesi istasyona geri yüklenebildi mi. */
  stationRestored: boolean;
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
  /** Ekranın TEK payload'ı: bayrak + istasyonlar + bekleyenler + dağıtılmışlar. */
  getDistribution: (): Promise<ApiResponse<KursunDistributionPayload>> =>
    apiClient
      .get<ApiResponse<KursunDistributionPayload>>('/kursun-bypass/distribution')
      .then((r) => r.data),

  /** İş emrinin kurşun adımını fiziksel istasyona dağıt (dağıtılmışsa TAŞI). */
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
