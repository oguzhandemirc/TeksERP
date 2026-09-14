// =============================================================================
// TEZGAH KOŞUMU (MachineRun) API istemcisi — aç · kapat · geri al
// =============================================================================
// Backend `/machine-runs` (`requireDokumaEnabled`; aç/kapa `mobile:dokuma`, geri
// alma `mobile:dokuma-geri-al`). Açık koşum listesi `doff.service.listOpenRuns`.
// Kuyruk YOK; `clientToken` mantıksal deneme başına bir kez (`runPayload.ts`).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { OpenMachineRun } from './doff.service';

export interface OpenRunRequest {
  machineId: string;
  productionLineNo: number;
  weavingOrderId: string | null;
  itemId: string | null;
  colorId: string | null;
  targetPicksPerMin: number | null;
  startedAt: string;
  clientToken: string;
}

export interface CloseRunRequest {
  endedAt: string;
  picksAtClose: number | null;
}

export const machineRunService = {
  /** 201 yeni · 201 replay (aynı token → özgün koşum, `message` "zaten"). */
  open: (body: OpenRunRequest): Promise<ApiResponse<OpenMachineRun>> =>
    apiClient.post<ApiResponse<OpenMachineRun>>('/machine-runs', body).then((r) => r.data),

  /** Kapanış terimleri donar; `picksAtClose` boşsa "ölçülmedi" (0 değil). */
  close: (id: string, body: CloseRunRequest): Promise<ApiResponse<OpenMachineRun>> =>
    apiClient.post<ApiResponse<OpenMachineRun>>(`/machine-runs/${id}/close`, body).then((r) => r.data),

  /** Damga; sebep zorunlu. Randımanın paydasını değiştirir — ayrı yetenek izni. */
  revoke: (id: string, reason: string): Promise<ApiResponse<OpenMachineRun>> =>
    apiClient.post<ApiResponse<OpenMachineRun>>(`/machine-runs/${id}/revoke`, { reason }).then((r) => r.data),
};
