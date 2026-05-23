import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams } from "../_services/types";

export interface DefectDistributionRow {
  defectName: string;
  count: number;
  processedCount: number;
  scrapCount: number;
  keptAsA1Count: number;
  noActionCount: number;
}

export interface StationDefectRateRow {
  stationId: string;
  stationName: string;
  stationKind: string;
  throughputRolls: number;
  defectCount: number;
  defectsPerRoll: number;
}

export interface Qc2DecisionsSummary {
  totalProcessed: number;
  decisions: { action: string; count: number }[];
  totalErrorsClosed: number;
  scrapClosed: number;
  keptAsA1: number;
  noAction: number;
}

export interface KursunApplicationSummary {
  qc2Completed: number;
  kursunApplied: number;
  applicationPct: number;
  daily: { day: string; kursun: number; qc2: number; pct: number }[];
}

export const qualityReportsApi = {
  defectDistribution: (p: ReportDateParams) =>
    reportsClient.get<DefectDistributionRow[]>("quality/defect-distribution", p),
  stationDefectRate: (p: ReportDateParams) =>
    reportsClient.get<StationDefectRateRow[]>("quality/station-defect-rate", p),
  qc2Decisions: (p: ReportDateParams) =>
    reportsClient.get<Qc2DecisionsSummary>("quality/qc2-decisions", p),
  kursunApplication: (p: ReportDateParams) =>
    reportsClient.get<KursunApplicationSummary>("quality/kursun-application", p),
};
