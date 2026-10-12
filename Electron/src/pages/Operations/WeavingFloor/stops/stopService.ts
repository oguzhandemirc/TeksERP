// Tezgah Salonu toplu duruş eylemleri (Duruş bildir · Hepsi çalıştı · Duruşu geri al) — `/api/machine-stops/bulk/*`
// YALNIZ bu dosyadan çağrılır. Ekran `tezgahEnabled` arkasındadır; bu dosyayı açan eylemler yalnız `dokumaEnabled`
// dalında doğar (`floorActions.ts`, bekçi `test_dokuma_regime_gate §7f`). Gövdeler sunucu Zod şemasının birebir aynası.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type BulkStopAction = "OPEN" | "CLOSE" | "REVOKE";
export type BulkStopOutcome = BulkStopAction | "BLOCKED";

export interface BulkStopPreviewRow {
  machineId: string;
  machineCode: string;
  machineName: string;
  /** Tezgahın açık duruşu (kapat/geri al hedefi; açışta "zaten duruşta" sebebi). */
  current: { id: string; startedAt: string; reasonCode: string | null } | null;
  outcome: BulkStopOutcome;
  defaultSelected: boolean;
  block: { code: string; message: string } | null;
}

export interface BulkStopPreview {
  action: BulkStopAction;
  at: string | null;
  rows: BulkStopPreviewRow[];
}

export interface BulkStopOk {
  machineId: string;
  machineCode: string;
  stopId: string;
  replayed: boolean;
  warnings: string[];
}

export interface BulkStopFailure {
  machineId: string;
  machineCode: string;
  code: string;
  message: string;
}

export interface BulkStopResult {
  requested: number;
  ok: BulkStopOk[];
  failed: BulkStopFailure[];
}

export interface BulkStopOpenBody {
  startedAt: string;
  reasonCode: string | null;
  reasonNote: string | null;
  rows: Array<{ machineId: string; clientToken: string }>;
}

const data = <T,>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data as T);

export const stopService = {
  preview: (body: { action: BulkStopAction; machineIds: string[]; at: string | null }): Promise<BulkStopPreview> =>
    data(apiClient.post<ApiResponse<BulkStopPreview>>("/api/machine-stops/bulk/preview", body)),
  open: (body: BulkStopOpenBody): Promise<BulkStopResult> => data(apiClient.post<ApiResponse<BulkStopResult>>("/api/machine-stops/bulk/open", body)),
  close: (body: { endedAt: string; rows: Array<{ stopId: string }> }): Promise<BulkStopResult> =>
    data(apiClient.post<ApiResponse<BulkStopResult>>("/api/machine-stops/bulk/close", body)),
  revoke: (body: { reason: string; rows: Array<{ stopId: string }> }): Promise<BulkStopResult> =>
    data(apiClient.post<ApiResponse<BulkStopResult>>("/api/machine-stops/bulk/revoke", body)),
};
