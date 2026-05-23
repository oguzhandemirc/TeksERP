// DOMAIN = CUD audit (Activity Page'in beslendiği kanal)
// AUTH   = login_success / login_failed
// SYSTEM = backend startup / unhandled error
export type SystemLogCategory = "DOMAIN" | "AUTH" | "SYSTEM";

export type SystemLogDomainAction = "CREATE" | "UPDATE" | "DELETE";
export type SystemLogAuthAction = "LOGIN_SUCCESS" | "LOGIN_FAILED";
export type SystemLogSystemAction = "STARTUP" | "ERROR";

export type SystemLogAction =
  | SystemLogDomainAction
  | SystemLogAuthAction
  | SystemLogSystemAction
  | string;

export interface SystemLogUserOption {
  id: string;
  username: string;
  fullName: string;
}

export interface SystemLogListItem {
  id: string;
  category: SystemLogCategory;
  action: SystemLogAction;
  tableName: string;
  recordId: string;
  ipAddress: string | null;
  createdAt: string;
  user: SystemLogUserOption | null;
}

export interface SystemLogDetail extends SystemLogListItem {
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  updatedAt: string;
}

export interface SystemLogListParams {
  cursor?: string;
  limit?: number;
  userId?: string;
  tableName?: string;
  category?: string; // "DOMAIN" | "AUTH" | "SYSTEM" | "AUTH,SYSTEM"
  action?: SystemLogAction;
  dateFrom?: string;
  dateTo?: string;
}

export interface SystemLogStats {
  activeCount: number;
  archiveCount: number;
  oldestLog: string | null;
  lastAutoArchiveAt: string | null;
}

export interface SystemLogArchiveResult {
  archived: number;
  cutoff: string;
}
