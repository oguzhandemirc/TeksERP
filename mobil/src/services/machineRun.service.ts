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
import type { WeavingOrderSummary } from './weavingOrder.service';

/** `GET /machine-runs/tablet-context?machineId=` — Z1 üretim belge zinciri: takılı leventin işi öneri. */
export interface MachineRunTabletContext {
  /** Takılı leventin bağlı olduğu açık IN_HOUSE iş (varsa) — Koşum aç'ta ön-seçim. */
  suggestedWeavingOrderId: string | null;
  suggestedFrom: 'MOUNTED_BEAM' | null;
  mountedBeam: { id: string; beamNo: string; weavingOrderId: string | null } | null;
  /** Bağlanabilir açık işler (kaynak etiketi için; ön-dolgu `weavingOrder.service.listOpen`dan renkle birlikte). */
  weavingOrders: {
    id: string;
    weavingOrderNumber: string;
    status: WeavingOrderSummary['status'];
    plannedM: number | null;
    item: { id: string; code: string; name: string };
    warpSpec: { id: string; code: string; name: string } | null;
  }[];
}

export interface OpenRunRequest {
  machineId: string;
  productionLineNo: number;
  weavingOrderId: string | null;
  itemId: string | null;
  colorId: string | null;
  targetUnitsPerMin: number | null;
  /** Tezgah üstü (ham) atkı/cm — backend `openSchema.unitsPerCm`; null = metre türetilmez. */
  unitsPerCm: number | null;
  startedAt: string;
  clientToken: string;
}

export interface CloseRunRequest {
  endedAt: string;
  picksAtClose: number | null;
}

export const machineRunService = {
  /** Takılı leventin işi öneri + açık işler (Koşum aç ön-seçimi). Eski sunucu 404 → çağıran boş bağlamla düşer. */
  tabletContext: (machineId: string): Promise<MachineRunTabletContext> =>
    apiClient.get<ApiResponse<MachineRunTabletContext>>('/machine-runs/tablet-context', { params: { machineId } }).then((r) => r.data.data),

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
