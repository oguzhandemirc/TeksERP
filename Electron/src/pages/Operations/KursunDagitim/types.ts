// Backend `kursun-bypass.service.ts` payload tipleriyle bire bir eşleşir.
// Kaynak: Teks-Erp/src/services/kursun-bypass.service.ts
//
// Tek FARK: backend `Date` döner, JSON serileştirmesi sonrası tel üzerinde
// ISO `string` olur — burada tarih alanları `string` tiplenir.

/**
 * Dağıtım hedefi = fiziksel kurşun MAKİNESİ (payload ile GELİR — ayrı makine
 * çağrısı YOK).
 *
 * ⚠️ Atama İSTASYONA değil MAKİNEYE yapılır: fabrikada PROCESS_QC türünde TEK
 * istasyon (Kurşun + KK2) var, altında N adet fiziksel kurşun makinesi duruyor.
 * `stationId`/`stationName` yalnız BAĞLAM (yetenek okuması backend'de makinenin
 * istasyonundan yapılır) — gruplama/ayırt etme anahtarı `id`'dir.
 */
export interface KursunBypassMachineOption {
  id: string;
  code: string;
  name: string;
  stationId: string;
  stationName: string;
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
  /**
   * `WorkOrderStep.priority` — MAKİNE İÇİ sıra. Sürükle-bırak bunu yeniden yazar
   * (bekleyen kuyrukla AYNI uç ve AYNI alan). Backend `assigned`'ı bu sıraya göre
   * döner; UI onu okumaz (yeni değerler index'ten üretilir) ama sözleşme burada
   * yazılı olmalı — alan sessizce düşerse liste "dağıtım anı" sırasına geri döner.
   */
  priority: number;
  assignmentId: string;
  /** ATANAN fiziksel kurşun makinesi — izleme/gruplama bu alanla yapılır. */
  machineId: string;
  machineCode: string;
  machineName: string;
  /** Makinenin istasyonu (pratikte hep aynı PROCESS_QC istasyonu) — bağlam. */
  stationId: string;
  stationName: string;
  assignedAt: string;
  assignedByName: string | null;
  notes: string | null;
  /** Atama artık anlamsız (adım kapandı / açık top kalmadı) → UI iptal önerir. */
  stale: boolean;
  staleReason: string | null;
}

/**
 * "Son N günde kaç iş DAĞITILMADAN Tambur'da kapandı" (2026-08-06).
 *
 * Dağıtım artık işin ön koşulu değil — unutulduğunda Tambur okutması kurşun
 * adımını kendisi kapatıyor. Ama dağıtılmadan kapanan iş makine bazlı hacim
 * raporunda ATIFSIZ kalır; bu sayaç o kaybı planlamacıya görünür kılar.
 */
export interface KursunUnassignedClosureStats {
  days: number;
  stepCount: number;
  rollCount: number;
}

export interface KursunDistributionPayload {
  /** `production.kursunBypassEnabled` — false ise YALNIZ yeni atama kapalıdır. */
  flagEnabled: boolean;
  /** Atama hedefleri: PROCESS_QC istasyonuna bağlı AKTİF kurşun makineleri. */
  machines: KursunBypassMachineOption[];
  waiting: KursunDistributionWaitingRow[];
  assigned: KursunDistributionAssignedRow[];
  /** Son 7 günde dağıtılmadan kapanan işler — bilgi bandının kaynağı. */
  unassignedClosures?: KursunUnassignedClosureStats;
}

// `KursunBypassVisibility` (menü sayaçları) 2026-08-05'te kaldırıldı — Kurşun
// Planlama karosu bayrak/sayaçtan bağımsız, yalnız izinle süzülüyor.

/**
 * TOPLU uçların ORTAK sonuç gövdesi — parçalı başarı sözleşmesi.
 *
 * `failed` boş değilse bazı satırlar ATLANMIŞTIR ve arayüz bunu göstermek
 * zorundadır; "N tamamlandı" deyip atlananları yutmak, planlamacıya yapılmamış
 * bir işi yapılmış gösterir.
 */
export interface KursunBulkResult {
  failed: Array<{ message: string }>;
}

export interface KursunBulkAssignResult extends KursunBulkResult {
  assigned: number;
  /** Bunlardan kaçı BAŞKA bir makineden taşındı (yeni atama değil). */
  moved: number;
  failed: Array<{ workOrderId: string; message: string }>;
}

export interface KursunBulkCancelResult extends KursunBulkResult {
  cancelled: number;
  failed: Array<{ assignmentId: string; message: string }>;
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
  /** İşin ATANDIĞI kurşun makinesi — onay ekranı "hangi makinede" yazar. */
  machineName: string;
  /** Makinenin istasyonu — bağlam bilgisi. */
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
  machineId: string;
  machineName: string;
  stationId: string;
  stationName: string;
  isLastStep: boolean;
  /** true = zaten dağıtılmıştı, MAKİNE değiştirildi (iş başka makineye taşındı). */
  reassigned: boolean;
}

/**
 * İptal YALNIZ atama satırını kapatır. "Adımın istasyonu geri yüklendi mi"
 * diye bir alan YOK: atama makine bazında yapılır, `WorkOrderStep.stationId`
 * hiç değiştirilmez → geri yüklenecek bir şey de yoktur.
 */
export interface KursunBypassCancelResult {
  assignmentId: string;
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
