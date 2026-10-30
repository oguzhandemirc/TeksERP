// Hizmet sarf normları (`/api/cost/consumable-norms`, D4-G1a): hizmet kalemi × sarf kalemi × metre başı miktar.
// Değiştirmek eski satırı DAMGALAR; birim sarf kaleminden doğuşta donar (sunucu). Token çağıranın denemesinden gelir.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

interface ItemBrief { id: string; code: string; name: string; itemType: string; isActive: boolean }

export interface ConsumableNorm {
  id: string; serviceItemId: string; consumableItemId: string; qtyPerM: string; unit: string; note: string | null;
  createdAt: string; revokedAt: string | null; revokeReason: string | null;
  serviceItem: ItemBrief; consumableItem: ItemBrief;
}

export interface NormValues { qtyPerM: string; note: string | null; clientToken: string }

export function buildNormBody(v: NormValues): NormValues {
  return { qtyPerM: v.qtyPerM, note: v.note, clientToken: v.clientToken };
}

const BASE = "/api/cost/consumable-norms";

export const consumableNormService = {
  listActive: async () => (await apiClient.get<ApiResponse<ConsumableNorm[]>>(BASE)).data.data,
  history: async (serviceItemId: string, consumableItemId: string) =>
    (await apiClient.get<ApiResponse<ConsumableNorm[]>>(BASE, {
      params: { "filter[serviceItemId]": serviceItemId, "filter[consumableItemId]": consumableItemId, includeRevoked: "1" },
    })).data.data,
  create: async (serviceItemId: string, consumableItemId: string, v: NormValues) =>
    (await apiClient.post<ApiResponse<ConsumableNorm>>(BASE, { serviceItemId, consumableItemId, ...buildNormBody(v) })).data,
  change: async (normId: string, v: NormValues) =>
    (await apiClient.post<ApiResponse<ConsumableNorm>>(`${BASE}/${normId}/change`, buildNormBody(v))).data,
  revoke: async (normId: string) => (await apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${normId}/revoke`, {})).data,
};
