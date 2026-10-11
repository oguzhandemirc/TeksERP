// Tezgah Salonu koşum eylemleri (İş ver · Değiştir · Bitir · Geri al) — `/api/machine-runs` salt bu dosyadan çağrılır.
// Ekran `tezgahEnabled` arkasındadır; bu dosyayı açan eylemler yalnız `dokumaEnabled` dalında doğar (`floorActions.ts`,
// bekçi `test_dokuma_regime_gate §7f`). Gövdeler sunucu Zod şemasının birebir aynası (tanınmayan anahtar sessizce düşer).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type BulkRunAction = "ASSIGN" | "FINISH";
export type BulkRunOutcome = "START" | "REPLACE" | "SAME_JOB" | "FINISH" | "BLOCKED";

export interface BulkTarget {
  machineId: string;
  productionLineNo: number;
}

export interface BulkPreviewRow extends BulkTarget {
  machineCode: string;
  machineName: string;
  productionLineCount: number;
  current: { id: string; weavingOrderId: string | null; weavingOrderNumber: string | null; startedAt: string } | null;
  outcome: BulkRunOutcome;
  defaultSelected: boolean;
  warnings: string[];
  block: { code: string; message: string } | null;
}

export interface BulkPreview {
  action: BulkRunAction;
  weavingOrder: { id: string; weavingOrderNumber: string } | null;
  rows: BulkPreviewRow[];
}

export interface JobOption {
  id: string;
  weavingOrderNumber: string;
  status: "PLANNED" | "IN_PROGRESS";
  plannedM: number | null;
  item: { id: string; code: string; name: string };
  warpSpec: { id: string; code: string; name: string } | null;
}

export interface BulkContext {
  weavingOrders: JobOption[];
  weavingOrderRequired: boolean;
}

export interface BulkFailure extends BulkTarget {
  machineCode: string;
  code: string;
  message: string;
}

export interface BulkOk extends BulkTarget {
  machineCode: string;
  runId: string;
  replacedRunId?: string | null;
  warnings?: string[];
}

export interface BulkResult {
  requested: number;
  ok: BulkOk[];
  failed: BulkFailure[];
}

export interface AssignRow extends BulkTarget {
  clientToken: string;
  replaceRunId?: string | null;
}

const data = <T,>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data as T);

export const runService = {
  context: (): Promise<BulkContext> => data(apiClient.get<ApiResponse<BulkContext>>("/api/machine-runs/bulk/context")),
  preview: (body: { action: BulkRunAction; weavingOrderId?: string | null; targets: BulkTarget[] }): Promise<BulkPreview> =>
    data(apiClient.post<ApiResponse<BulkPreview>>("/api/machine-runs/bulk/preview", body)),
  assign: (body: { weavingOrderId: string | null; rows: AssignRow[] }): Promise<BulkResult> =>
    data(apiClient.post<ApiResponse<BulkResult>>("/api/machine-runs/bulk/assign", body)),
  finish: (body: { rows: Array<{ runId: string; picksAtClose?: number | null }> }): Promise<BulkResult> =>
    data(apiClient.post<ApiResponse<BulkResult>>("/api/machine-runs/bulk/finish", body)),
  revoke: (runId: string, reason: string): Promise<unknown> =>
    data(apiClient.post<ApiResponse<unknown>>(`/api/machine-runs/${encodeURIComponent(runId)}/revoke`, { reason })),
};
