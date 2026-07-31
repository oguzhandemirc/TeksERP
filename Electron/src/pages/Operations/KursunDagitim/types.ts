// Backend `kursun-bypass.service.ts` payload tipleriyle bire bir eşleşir.
// Kaynak: Teks-Erp/src/services/kursun-bypass.service.ts
//
// Tek FARK: backend `Date` döner, JSON serileştirmesi sonrası tel üzerinde
// ISO `string` olur — burada tarih alanları `string` tiplenir.

/** Fiziksel kurşun istasyonu seçeneği (payload ile GELİR — ayrı istasyon çağrısı YOK). */
export interface KursunBypassStationOption {
  id: string;
  code: string;
  name: string;
}

/** Dağıtım ekranındaki bir satırın ORTAK gövdesi (bekleyen + dağıtılmış). */
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
  /** Açık topların TOPLAM güncel metrajı. */
  totalMeters: number;
  oldestEnteredAt: string | null;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
  /** Kurşun rotanın son (non-SKIPPED) adımı mı → "İşi Bitir" bu satırda çıkar. */
  isLastStep: boolean;
}

export interface KursunDistributionWaitingRow extends KursunDistributionRowBase {
  /** Bu adım bypass'a dağıtılabilir mi? */
  eligible: boolean;
  /** Uygunluk kurallarından HANGİSİ düştü — somut sebep (null = uygun). */
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
  rolls: KursunBypassPreviewRoll[];
  willFinalize: {
    targetStatus: "WAREHOUSE";
    /** Kalite bypass'ta ASLA yazılmaz — "Belirsiz" kalır. */
    qualityStaysNull: true;
    /** Barkodsuz açık kumaşa finalize sırasında üretilecek barkod adedi. */
    barcodesToGenerate: number;
  };
  /** Bu tamamlama iş emrini de COMPLETED yapacak mı? */
  workOrderWillComplete: boolean;
}

export interface KursunBypassAssignResult {
  assignmentId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderStepId: string;
  stationId: string;
  stationName: string;
  isLastStep: boolean;
  /** true = zaten dağıtılmıştı, istasyon değiştirildi. */
  reassigned: boolean;
}

export interface KursunBypassCancelResult {
  assignmentId: string;
  /** Adımın istasyonu atama öncesine geri yüklendi mi (false = arada elle değişmiş). */
  stationRestored: boolean;
  workOrderId: string;
}

export interface KursunBypassCompleteResult {
  /** true = idempotent tekrar; bu çağrı hiçbir şeyi değiştirmedi. */
  alreadyDone: boolean;
  finalizedRollCount: number;
  barcodesGenerated: number;
}

export interface KursunQueueUrgentResult {
  id: string;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
}
