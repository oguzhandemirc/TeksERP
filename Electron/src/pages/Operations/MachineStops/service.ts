// =============================================================================
// TEZGAH DURUŞU API İSTEMCİSİ — `/api/machine-stops`
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR ("/api/…") — `apiClient.baseURL` `/api` İÇERMEZ.
// ⚠️ Bu dosya dokuma uçlarını çağıran ikinci istemci dosyasıdır ve backend
// bekçisi `test_dokuma_regime_gate §7` onu ADIYLA allowlist'te tutar: çağıran
// ekranın karosu `dokumaEnabled`e bağlı olmak zorunda.
// Süzme SUNUCUDA: makine · gün · vardiya · kuyruk (`requiresReason ∧ reasonCode null`).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { MachineStop, StopReclass } from "./types";

const BASE = "/api/machine-stops";

export interface StopListParams {
  machineId?: string;
  factoryDay?: string;
  shiftInstanceId?: string;
  queue?: boolean;
  open?: boolean;
}

export interface OpenStopPayload {
  machineId: string;
  startedAt: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  /** Elle girişte KİMLİK (`stopKey`): mantıksal deneme başına bir kez; replay aynı satırı döner. */
  clientToken: string;
}

export const machineStopService = {
  list: (p: StopListParams) => {
    const sp = new URLSearchParams();
    sp.set("limit", "500");
    if (p.machineId) sp.set("machineId", p.machineId);
    if (p.factoryDay) sp.set("factoryDay", p.factoryDay);
    if (p.shiftInstanceId) sp.set("shiftInstanceId", p.shiftInstanceId);
    if (p.queue) sp.set("queue", "true");
    if (p.open) sp.set("open", "true");
    return apiClient.get<ApiResponse<MachineStop[]>>(`${BASE}?${sp.toString()}`).then((r) => r.data);
  },
  reclasses: (id: string) => apiClient.get<ApiResponse<StopReclass[]>>(`${BASE}/${id}/reclasses`).then((r) => r.data),
  /** Aralık dışı damga 400'ü (`STOP_STAMP_OUT_OF_RANGE`) diyalogda ALAN hatasıdır, toast değil — genel toast bastırılır, diğer hataları hook basar. */
  open: (body: OpenStopPayload) => apiClient.post<ApiResponse<MachineStop>>(BASE, body, { suppressErrorToast: true }).then((r) => r.data),
  close: (id: string, endedAt: string | null) => apiClient.post<ApiResponse<MachineStop>>(`${BASE}/${id}/close`, { endedAt }, { suppressErrorToast: true }).then((r) => r.data),
  /** İLK karar — claim `reasonCode IS NULL`; ikinci sınıflandırma yerinde ezmez (409). */
  classify: (id: string, body: { reasonCode: string; reasonNote: string | null }) =>
    apiClient.post<ApiResponse<MachineStop>>(`${BASE}/${id}/classify`, body).then((r) => r.data),
  /** `fromReasonCode` claim çıpası (bayat karar üstüne yazılmaz: 409 STOP_RECLASS_STALE); defter satırı yazılır. */
  reclassify: (id: string, body: { fromReasonCode: string; toReasonCode: string; reason: string | null }) =>
    apiClient.post<ApiResponse<MachineStop>>(`${BASE}/${id}/reclassify`, body).then((r) => r.data),
  revoke: (id: string, reason: string) => apiClient.post<ApiResponse<MachineStop>>(`${BASE}/${id}/revoke`, { reason }).then((r) => r.data),
};
