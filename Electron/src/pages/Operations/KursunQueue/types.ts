// Backend `KursunQueueItem` ile bire bir eşleşir.
// Kaynak: Teks-Erp/src/services/kursun-qc.service.ts
// WO seviyesinde — her satır bir refakat kartı (WorkOrderStep PROCESS_QC).
export interface KursunQueueItem {
  /// WorkOrderStep.id — reorder/urgent endpoint'leri bu id'yi alır.
  workOrderStepId: string;
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
}
