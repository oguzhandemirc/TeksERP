// Terbiye/fason tarifeleri (`/api/cost/finishing-rates`). Aynı kodla yazmak YENİ sürüm doğurur, eskisi damgalanır;
// gövde açık alan listesiyle kurulur, tutarlar Decimal METNİ gider.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";

// SY-E1: KG = boyahane kilo ücreti; motor kg'ı sunucuda ham metreye çevirir (`maliyet.terbiyeKgTabani`).
export type FinishingBasis = "RAW_M" | "FINISHED_M" | "KG";
export const FINISHING_BASIS_LABEL: Record<FinishingBasis, string> = { RAW_M: "Ham metre", FINISHED_M: "Mamul metre", KG: "Kilo (kg)" };
/** Fiyatın birimi — `pricePerM` kolonu "tabanın birimi başına" okunur. */
export const finishingBasisUnit = (b: FinishingBasis): string => (b === "KG" ? "kg" : "m");

export interface FinishingRate {
  id: string; code: string; name: string; subcontractorId: string | null; basis: FinishingBasis; currency: Currency;
  pricePerM: string; typicalShrinkPct: string | null; note: string | null; revokedAt: string | null; createdAt: string;
  subcontractor: { id: string; name: string } | null;
}

export interface FinishingRateInput {
  code: string; name: string; subcontractorId: string | null; basis: FinishingBasis; currency: Currency;
  pricePerM: string; typicalShrinkPct: string | null; note: string | null;
}

export function buildFinishingRateBody(i: FinishingRateInput): FinishingRateInput {
  return {
    code: i.code, name: i.name, subcontractorId: i.subcontractorId, basis: i.basis, currency: i.currency,
    pricePerM: i.pricePerM, typicalShrinkPct: i.typicalShrinkPct, note: i.note,
  };
}

const BASE = "/api/cost/finishing-rates";

export const finishingRateService = {
  listActive: async () => (await apiClient.get<ApiResponse<FinishingRate[]>>(BASE)).data.data,
  history: async (code: string) => (await apiClient.get<ApiResponse<FinishingRate[]>>(BASE, { params: { code, includeRevoked: "1" } })).data.data,
  change: async (i: FinishingRateInput) => (await apiClient.post<ApiResponse<FinishingRate & { wrote: boolean }>>(BASE, buildFinishingRateBody(i))).data,
  revoke: async (id: string) => (await apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${id}/revoke`, {})).data,
};
