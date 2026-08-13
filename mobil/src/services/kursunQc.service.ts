import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { KursunStepSummary, KursunOpenCard } from '../types/models';

// Kurşun + QC2 (PROCESS_QC istasyonu) operatör akışı.
// Backend tarafı: src/services/kursun-qc.service.ts
// Refakat kartı çözümü → step özeti + per-roll durum (qc2, hatalar) döner.
// Per-roll Kurşun toggle'ı yoktur — kurşun istasyon yeteneğidir
// (istasyona KURSUN özelliği atanmışsa, QC2 tamamlanan her top otomatik
// kurşunlanır). Operatör her aksiyon sonrası mobil tarafta job'ı yeniden
// çekmeli — local state gerçek state'in shadow'u olarak güncel kalsın.

export interface CompleteQc2Request {
  rollId: string;
  stepId: string;
  notes?: string | null;
  /**
   * Operatörün CEVAPLARI (2026-08-10 mod + 2026-08-11 değer sözleşmesi).
   *
   * AUTO modundaki özellikler bu listede OLMASA DA topa yazılır — backend onları
   * kendisi ekler. Buraya yalnız OPSİYONEL/ZORUNLU modundakiler girer.
   * ZORUNLU bir özellik eksikse backend 400 döner (adıyla).
   *
   * ⚠️ SEÇİM tipli özellikte `valueCode` ZORUNLUDUR (GRAMAJ → "50GR");
   * BAYRAK tipinde gönderilirse backend 400 verir.
   *
   * Alan gönderilmezse davranış eskisi gibidir (yalnız AUTO uygulanır) — yani
   * eski APK yeni backend'e karşı bugünkü sonucu üretir.
   */
  properties?: { propertyId: string; valueCode?: string }[];
}

export interface ReportErrorRequest {
  rollId: string;
  stepId: string;
  startMeter: number;
  defectTypeId: string;
  /** Offline kuyruğu için client-üretimi UUID (generateClientUuid). Backend bunu
   *  RollError.id olarak kullanır → resume/retry idempotent olur. */
  clientErrorId?: string;
}

export interface DeleteErrorRequest {
  errorId: string;
}

export interface FinishStepRequest {
  stepId: string;
}

export interface ReopenPreviewRoll {
  rollId: string;
  barcode: string | null;
  currentQty: number;
}

export interface ReopenPreview {
  /** reopenStep güvenli mi (toplar hâlâ sonraki adımda + üretimde mi). */
  canReopen: boolean;
  /** canReopen=false ise sebep (örn. top ileri taşınmış). */
  blockReason: string | null;
  rollCount: number;
  /** Yeniden açılırsa Tambur'dan geri çekilecek toplar. */
  rolls: ReopenPreviewRoll[];
}

export const kursunQcService = {
  // Refakat kartı barkodu ile WO PROCESS_QC adımını + açık topları çek
  getByCardBarcode: (barcode: string): Promise<ApiResponse<KursunStepSummary>> =>
    apiClient
      .get<ApiResponse<KursunStepSummary>>(
        `/kursun-qc/by-card/${encodeURIComponent(barcode)}`
      )
      .then((r) => r.data),

  // Adım ID'siyle direkt çek — refresh sonrası state'i tazelemek için
  getStep: (stepId: string): Promise<ApiResponse<KursunStepSummary>> =>
    apiClient
      .get<ApiResponse<KursunStepSummary>>(`/kursun-qc/step/${stepId}`)
      .then((r) => r.data),

  // PROCESS_QC adımlarında açık top bekleyen aktif kartlar — kamera modal'ı için
  listOpenCards: (): Promise<ApiResponse<KursunOpenCard[]>> =>
    apiClient
      .get<ApiResponse<KursunOpenCard[]>>('/kursun-qc/open-cards')
      .then((r) => r.data),

  completeQc2: (data: CompleteQc2Request): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/kursun-qc/complete-qc2', data)
      .then((r) => r.data),

  reportError: (data: ReportErrorRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/kursun-qc/report-error', data)
      .then((r) => r.data),

  deleteError: (data: DeleteErrorRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .delete<ApiResponse<unknown>>('/kursun-qc/error', { data })
      .then((r) => r.data),

  finishStep: (data: FinishStepRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/kursun-qc/finish-step', data)
      .then((r) => r.data),

  // Yanlışlıkla kapatılan adımı yeniden aç (geliştirme aşaması yardımcısı)
  reopenStep: (data: FinishStepRequest): Promise<ApiResponse<{ reopenedRollCount: number }>> =>
    apiClient
      .post<ApiResponse<{ reopenedRollCount: number }>>('/kursun-qc/reopen-step', data)
      .then((r) => r.data),

  // reopen-step öncesi salt-okunur önizleme — onay modalında hangi topların
  // Tambur'dan geri çekileceğini göstermek için.
  reopenPreview: (stepId: string): Promise<ApiResponse<ReopenPreview>> =>
    apiClient
      .get<ApiResponse<ReopenPreview>>(`/kursun-qc/reopen-preview/${stepId}`)
      .then((r) => r.data),
};
