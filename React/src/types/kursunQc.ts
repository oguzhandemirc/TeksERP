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

export interface KursunQcDefectSummary {
  id: string;
  startMeter: number;
  endMeter: number;
  defectTypeId: string | null;
  errorType: string | null; // DefectType.name snapshot
}

export interface KursunQcRollSummary {
  rollId: string;
  barcode: string;
  currentQty: number;
  kursunApplied: boolean;
  qc2Completed: boolean;
  errorCount: number;
  defects: KursunQcDefectSummary[];
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
