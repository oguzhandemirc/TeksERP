// Hizmet sarf normları (`/api/cost/consumable-norms`, D4-G1a): hizmet kalemi × sarf kalemi × metre başı miktar.
// Değiştirmek eski satırı DAMGALAR; birim sarf kaleminden doğuşta donar (sunucu). Token çağıranın denemesinden gelir.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

interface ItemBrief { id: string; code: string; name: string; itemType: string; isActive: boolean }

export type NormBasis = "PER_METER" | "PER_ROLL";

export interface ConsumableNorm {
  id: string; serviceItemId: string; consumableItemId: string; qtyPerM: string; unit: string; note: string | null;
  /** Eski backend göndermez → PER_METER / çeşitsiz sayılır. */
  basis?: NormBasis; propertyValueId?: string | null;
  propertyValue?: { id: string; name: string; amount: string | null } | null;
  createdAt: string; revokedAt: string | null; revokeReason: string | null;
  serviceItem: ItemBrief; consumableItem: ItemBrief;
}

export interface NormValues { qtyPerM: string; basis: NormBasis; note: string | null; clientToken: string }

export function buildNormBody(v: NormValues): NormValues {
  return { qtyPerM: v.qtyPerM, basis: v.basis, note: v.note, clientToken: v.clientToken };
}

const BASE = "/api/cost/consumable-norms";

export const consumableNormService = {
  listActive: async (search?: string) => (await apiClient.get<ApiResponse<ConsumableNorm[]>>(BASE, { params: search ? { search } : {} })).data.data,
  history: async (serviceItemId: string, consumableItemId: string) =>
    (await apiClient.get<ApiResponse<ConsumableNorm[]>>(BASE, {
      params: { "filter[serviceItemId]": serviceItemId, "filter[consumableItemId]": consumableItemId, includeRevoked: "1" },
    })).data.data,
  create: async (key: { serviceItemId: string; consumableItemId: string; propertyValueId: string | null }, v: NormValues) =>
    (await apiClient.post<ApiResponse<ConsumableNorm>>(BASE, { ...key, ...buildNormBody(v) })).data,
  change: async (normId: string, v: NormValues) =>
    (await apiClient.post<ApiResponse<ConsumableNorm>>(`${BASE}/${normId}/change`, buildNormBody(v))).data,
  revoke: async (normId: string) => (await apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${normId}/revoke`, {})).data,
};
