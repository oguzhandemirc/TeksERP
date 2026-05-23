import apiClient from "@/services/apiClient";
import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams } from "../_services/types";

export interface SubcontractPerformanceRow {
  subcontractorId: string;
  subcontractorName: string;
  dispatchCount: number;
  rollsDispatched: number;
  rollsReturned: number;
  rollsOpen: number;
  qtyDispatched: number;
  avgTurnaroundDays: number | null;
}

export interface OpenDispatchRow {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  subcontractorName: string;
  workOrderNumber: string | null;
  openItems: number;
  totalItems: number;
  daysOpen: number;
}

export const subcontractReportsApi = {
  performance: (p: ReportDateParams) =>
    reportsClient.get<SubcontractPerformanceRow[]>("subcontract/performance", p),
  openDispatches: async () => {
    const res = await apiClient.get<{ success: true; data: OpenDispatchRow[] }>(
      "/api/reports/subcontract/open-dispatches",
    );
    return res.data;
  },
};
