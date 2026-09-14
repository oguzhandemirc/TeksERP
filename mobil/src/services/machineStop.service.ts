// =============================================================================
// TEZGAH DURUŞU (MachineStopEvent) API istemcisi — aç · kapat · sebep ata · geri al
// =============================================================================
// Backend `/machine-stops` (`requireDokumaEnabled`; aç/kapa/sebep `mobile:dokuma`,
// geri alma `mobile:dokuma-geri-al`; YENİDEN sınıflandırma yalnız web `loom:classify`).
// Kimlik SAAT DEĞİL TOKEN: `clientToken` = `stopKey`, replay aynı satırı döner.
// Kuyruk YOK (`stopPayload.ts`).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export type StopLossClass = 'UNPLANNED' | 'SETUP' | 'PLANNED' | 'NON_SCHEDULED' | 'MINOR';

export interface MachineStop {
  id: string;
  machineId: string;
  runId: string | null;
  stopKey: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  reasonCode: string | null;
  lossClass: StopLossClass | null;
  reasonNote: string | null;
  /** Açılışta sebep verilmediyse sınıflandırma BORCU — ekran "sebep ata" çizer. */
  requiresReason: boolean;
  source: 'MACHINE' | 'INFERRED' | 'OPERATOR' | 'SUPERVISOR' | 'SIMULATED';
  revokedAt: string | null;
}

export interface OpenStopRequest {
  machineId: string;
  startedAt: string;
  reasonCode: string | null;
  reasonNote: string | null;
  clientToken: string;
}

export interface ClassifyStopRequest {
  reasonCode: string;
  reasonNote: string | null;
}

export const machineStopService = {
  listOpen: async (machineId: string): Promise<MachineStop[]> => {
    const res = await apiClient.get<ApiResponse<MachineStop[]>>('/machine-stops', { params: { machineId, open: 'true', limit: 5 } });
    return res.data.data ?? [];
  },
  open: async (body: OpenStopRequest): Promise<ApiResponse<MachineStop>> => (await apiClient.post<ApiResponse<MachineStop>>('/machine-stops', body)).data,
  close: async (id: string, endedAt: string): Promise<ApiResponse<MachineStop>> =>
    (await apiClient.post<ApiResponse<MachineStop>>(`/machine-stops/${id}/close`, { endedAt })).data,
  classify: async (id: string, body: ClassifyStopRequest): Promise<ApiResponse<MachineStop>> =>
    (await apiClient.post<ApiResponse<MachineStop>>(`/machine-stops/${id}/classify`, body)).data,
  revoke: async (id: string, reason: string): Promise<ApiResponse<MachineStop>> =>
    (await apiClient.post<ApiResponse<MachineStop>>(`/machine-stops/${id}/revoke`, { reason })).data,
};
