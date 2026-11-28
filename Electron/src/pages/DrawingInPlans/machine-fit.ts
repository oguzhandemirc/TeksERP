// Tezgâh ↔ tahar uçları (T2/T3; backend `helpers/machine-drawing-in.helper.ts` aynası, dokuma modülü kapısı).
// Takılı tahar "şu an ne"dir: otomatik (levent takma / koşum açılışı) ya da tezgâh tanımında elle düzeltme.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

const BASE = "/api/drawing-in-plans";

export type MountedDrawingInSource = "AUTO" | "MANUAL";

export interface MachineDrawingInFit {
  machine: {
    id: string;
    code: string;
    name: string;
    frameCount: number | null;
    mountedDrawingInSource: MountedDrawingInSource | null;
    mountedDrawingInAt: string | null;
    mountedDrawingInPlan: { id: string; code: string; name: string; frameCount: number; notation: string; isActive: boolean } | null;
    mountedDrawingInBy: { id: string; fullName: string } | null;
  };
  /** Tahar değiştirmeden girebilen kumaşlar (aynı tekrar birimi özeti). */
  items: Array<{ id: string; code: string; name: string; planId: string | null; planCode: string | null }>;
}

export interface PlanMachines {
  plan: { id: string; code: string; name: string; frameCount: number };
  machines: Array<{ id: string; code: string; name: string; frameCount: number | null; source: MountedDrawingInSource | null; mountedAt: string | null; planId: string | null; planCode: string | null }>;
}

export const SOURCE_LABEL: Record<MountedDrawingInSource, string> = { AUTO: "otomatik", MANUAL: "elle" };

export const machineDrawingInApi = {
  fit: (machineId: string) => apiClient.get<ApiResponse<MachineDrawingInFit>>(`${BASE}/machines/${machineId}`).then((r) => r.data.data),
  setMounted: (machineId: string, drawingInPlanId: string | null) =>
    apiClient.put<ApiResponse<{ changed: boolean }>>(`${BASE}/machines/${machineId}`, { drawingInPlanId }).then((r) => r.data),
  machinesForPlan: (planId: string) => apiClient.get<ApiResponse<PlanMachines>>(`${BASE}/${planId}/machines`).then((r) => r.data.data),
};
