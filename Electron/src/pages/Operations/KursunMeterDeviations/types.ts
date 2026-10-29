// Kurşun metre sapmaları — backend `kursun-meter-deviation-list.helper.ts` sözleşmesinin aynası.
export const DEVIATION_STATUSES = ["PENDING", "UNSIGNED", "ACKED"] as const;
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number];
export type MeterSource = "MACHINE" | "OPERATOR" | "SUPERVISOR" | "SIMULATED" | "INFERRED";
export type ApprovalMode = "NONE" | "OPERATOR_REASON" | "SUPERVISOR_PIN" | "OFFICE";

export interface MeterDeviationRow {
  readingId: string;
  rollId: string;
  barcode: string | null;
  stepId: string;
  workOrderNumber: string | null;
  machineId: string | null;
  machineName: string | null;
  customerId: string | null;
  customerName: string | null;
  declaredIn: number | null;
  measuredIn: number | null;
  baseMeters: number | null;
  outMeters: number;
  diffMeters: number | null;
  thresholdM: number | null;
  thresholdPct: number | null;
  basis: "DECLARED_IN" | "MEASURED_IN";
  approvalMode: ApprovalMode;
  source: MeterSource;
  status: DeviationStatus;
  ack: { mode: ApprovalMode; reasonCode: string | null; reasonText: string | null; approvedByName: string | null; createdAt: string } | null;
  createdAt: string;
}

export interface MeterDeviationSummary {
  total: number;
  unsigned: number;
  pending: number;
  avgDiffMeters: number | null;
  avgAbsDiffMeters: number | null;
}

export interface MeterDeviationPage {
  success: boolean;
  data: MeterDeviationRow[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number };
  summary: MeterDeviationSummary;
}

export interface DeviationFilter {
  status: DeviationStatus | null;
  machineId: string | null;
  customerId: string | null;
  /** Fabrika günü `YYYY-MM-DD`; boş = sınırsız. */
  from: string;
  to: string;
}
