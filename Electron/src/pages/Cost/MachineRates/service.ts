// Makine saat ücretleri (`/api/cost/machine-rates`, D4-G1a). Değiştirmek eski satırı DAMGALAR, yenisini yazar
// ("şu andan itibaren"); yaratma/değişim `clientToken` taşır — token çağıranın DENEMESİNDEN gelir, burada üretilmez.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface MachineCostRate {
  id: string; machineId: string; hourRateTry: string; normMPerHour: string | null; note: string | null;
  createdAt: string; revokedAt: string | null; revokeReason: string | null;
  machine: { id: string; code: string; name: string; isActive: boolean };
}

export interface MachineRateValues { hourRateTry: string; normMPerHour: string | null; note: string | null; clientToken: string }

/** Gövde açık alan listesiyle kurulur (sunucu `.strict()` — fazla alan 400). */
export function buildMachineRateBody(v: MachineRateValues): MachineRateValues {
  return { hourRateTry: v.hourRateTry, normMPerHour: v.normMPerHour, note: v.note, clientToken: v.clientToken };
}

const BASE = "/api/cost/machine-rates";

export const machineRateService = {
  listActive: async () => (await apiClient.get<ApiResponse<MachineCostRate[]>>(BASE)).data.data,
  history: async (machineId: string) =>
    (await apiClient.get<ApiResponse<MachineCostRate[]>>(BASE, { params: { "filter[machineId]": machineId, includeRevoked: "1" } })).data.data,
  create: async (machineId: string, v: MachineRateValues) =>
    (await apiClient.post<ApiResponse<MachineCostRate>>(BASE, { machineId, ...buildMachineRateBody(v) })).data,
  change: async (rateId: string, v: MachineRateValues) =>
    (await apiClient.post<ApiResponse<MachineCostRate>>(`${BASE}/${rateId}/change`, buildMachineRateBody(v))).data,
  revoke: async (rateId: string) => (await apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${rateId}/revoke`, {})).data,
};
