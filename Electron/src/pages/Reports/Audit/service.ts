import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams } from "../_services/types";

export interface SystemLogSummary {
  totalLogs: number;
  byAction: { action: string; count: number }[];
  byTable: { tableName: string; count: number }[];
  daily: { day: string; create: number; update: number; delete: number }[];
}

export interface UserActivityRow {
  userId: string | null;
  username: string | null;
  fullName: string | null;
  createCount: number;
  updateCount: number;
  deleteCount: number;
  totalCount: number;
  lastActionAt: string | null;
}

export const auditReportsApi = {
  systemLogSummary: (p: ReportDateParams) =>
    reportsClient.get<SystemLogSummary>("audit/system-log-summary", p),
  userActivity: (p: ReportDateParams) =>
    reportsClient.get<UserActivityRow[]>("audit/user-activity", p),
};
