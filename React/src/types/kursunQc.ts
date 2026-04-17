export const StationKind = {
  RAW_QC: "RAW_QC",
  PROCESS_QC: "PROCESS_QC",
  TAMBUR: "TAMBUR",
  SUBCONTRACTOR: "SUBCONTRACTOR",
  PACKAGING: "PACKAGING",
  SHIPPING: "SHIPPING",
  OTHER: "OTHER",
} as const;
export type StationKind = (typeof StationKind)[keyof typeof StationKind];

export const stationKindLabels: Record<StationKind, string> = {
  RAW_QC: "Ham Kalite Kontrol (KK1)",
  PROCESS_QC: "Kurşun + Kalite Kontrol 2",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  PACKAGING: "Paketleme",
  SHIPPING: "Sevkiyat",
  OTHER: "Diğer",
};

export const RollOperationType = {
  KURSUN_APPLIED: "KURSUN_APPLIED",
  QC2_COMPLETED: "QC2_COMPLETED",
  TAMBUR_PROCESSED: "TAMBUR_PROCESSED",
  PACKAGED: "PACKAGED",
  SUBCONTRACTOR_SENT: "SUBCONTRACTOR_SENT",
  SUBCONTRACTOR_RETURNED: "SUBCONTRACTOR_RETURNED",
} as const;
export type RollOperationType =
  (typeof RollOperationType)[keyof typeof RollOperationType];

export interface RollOperation {
  id: string;
  rollId: string;
  workOrderStepId: string;
  operationType: RollOperationType;
  operatorId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface KursunQcRollSummary {
  rollId: string;
  barcode: string;
  currentQty: number;
  kursunApplied: boolean;
  qc2Completed: boolean;
  errorCount: number;
}

export interface KursunQcStepSummary {
  workOrderStepId: string;
  stationId: string;
  stationCode: string;
  stationName: string;
  workOrderId: string;
  batchNumber: string;
  rolls: KursunQcRollSummary[];
}
