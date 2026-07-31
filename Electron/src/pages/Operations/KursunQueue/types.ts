// Backend `KursunQueueItem` ile bire bir eşleşir.
// Kaynak: Teks-Erp/src/services/kursun-qc.service.ts
// WO seviyesinde — her satır bir refakat kartı (WorkOrderStep PROCESS_QC).
export interface KursunQueueItem {
  /// WorkOrderStep.id — reorder/urgent endpoint'leri bu id'yi alır.
  workOrderStepId: string;
  /// Adımın İSTASYONU. Fabrikada PROCESS_QC türünde TEK istasyon var → bu alan
  /// pratikte her satırda AYNIDIR; gruplama anahtarı DEĞİL, yalnız bağlamdır.
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  travelerCardNumber: string | null;
  travelerCardBarcode: string | null;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  totalCurrentQty: number;
  oldestEnteredAt: string | null;
  priority: number;
  isUrgent: boolean;
  urgentMarkedAt: string | null;
  /**
   * Bu adım kurşun dağıtımına (bypass) verilmiş mi — satırda "Bypass" rozeti.
   *
   * ⚠️ GRUPLAMA ANAHTARI DEĞİL, KARIŞIK REJİM BİLGİSİDİR. Bu ekran bypass
   * bayrağı AÇIKKEN tamamen gizlenir; alan yalnız bayrağın yeni açıldığı ara
   * dönemde (hâlâ tablet rejiminde bekleyen işler varken) planlamacı hangisinin
   * dağıtıldığını ayırt edebilsin diye taşınır. İzleme/gruplama yüzeyi Kurşun
   * Dağıtım ekranıdır.
   */
  bypassAssigned: boolean;
  /** Dağıtımın atandığı fiziksel kurşun makinesinin adı; null = dağıtılmamış. */
  bypassMachineName: string | null;
}
