import apiClient from "@/services/apiClient";
import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams, ReportResponse } from "../_services/types";

// ---- Veri tipleri (backend birebir) ---------------------------------------

export interface StationEfficiencyRow {
  stationId: string;
  stationName: string;
  stationKind: string;
  rollCount: number;
  qtyIn: number;
  qtyOut: number;
  avgDurationMin: number | null;
  stillIn: number;
}

export interface OperatorPerformanceRow {
  userId: string;
  username: string;
  fullName: string;
  totalOps: number;
  kursunCount: number;
  qc2Count: number;
  tamburCount: number;
  subcontractorOps: number;
}

export interface MachineUsageRow {
  machineId: string;
  machineName: string;
  stationId: string;
  stationName: string;
  stationKind: string;
  opCount: number;
  rollCount: number;
}

export interface TravelerEvent {
  type: "MOVEMENT_IN" | "MOVEMENT_OUT" | "OPERATION";
  at: string;
  stationId: string | null;
  stationName: string | null;
  stationKind: string | null;
  operatorId: string | null;
  operatorName: string | null;
  machineName: string | null;
  qty: number | null;
  operationType: string | null;
  notes: string | null;
}

export interface TravelerTraceResult {
  roll: {
    id: string;
    barcode: string | null;
    status: string;
    qualityGrade: string;
    initialQty: number;
    currentQty: number;
    width: number | null;
    createdAt: string;
  };
  events: TravelerEvent[];
}

export interface ScrapSummary {
  totalScrapRolls: number;
  totalScrapQty: number;
  daily: { day: string; count: number; qty: number }[];
  byDefect: { defectName: string; count: number }[];
}

// ---- API çağrıları --------------------------------------------------------

export const productionReportsApi = {
  stationEfficiency: (params: ReportDateParams) =>
    reportsClient.get<StationEfficiencyRow[]>("production/station-efficiency", params),
  operatorPerformance: (params: ReportDateParams) =>
    reportsClient.get<OperatorPerformanceRow[]>("production/operator-performance", params),
  machineUsage: (params: ReportDateParams) =>
    reportsClient.get<MachineUsageRow[]>("production/machine-usage", params),
  scrap: (params: ReportDateParams) =>
    reportsClient.get<ScrapSummary>("production/scrap", params),
  travelerTrace: async (rollId: string) => {
    const res = await apiClient.get<{ success: true; data: TravelerTraceResult }>(
      `/api/reports/production/traveler-trace?rollId=${encodeURIComponent(rollId)}`,
    );
    return res.data;
  },
};

export type ProductionReportResponse<T> = ReportResponse<T>;
