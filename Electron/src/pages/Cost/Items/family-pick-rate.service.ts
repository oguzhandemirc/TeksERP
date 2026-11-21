// Desen ailesine toplu atkı ücreti (`/api/cost/pick-rate-families`, SY-C3): önizleme yazmaz, uygula yalnız seçilenleri.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";

export interface PickFamily { familyLabel: string; designCount: number; itemCount: number }
export interface PickFamilyRow {
  itemId: string; code: string; name: string; isActive: boolean; designCode: string; designName: string;
  current: { rate: string | null; currency: Currency | null; source: "YAPI" | "PARAMETRE" | "YOK" };
}
export interface PickFamilyPreview { familyLabel: string; rows: PickFamilyRow[]; parameterDefault: { rate: string; currency: Currency } | null }

const BASE = "/api/cost/pick-rate-families";

export const pickFamilyService = {
  list: async () => (await apiClient.get<ApiResponse<PickFamily[]>>(BASE)).data.data,
  preview: async (familyLabel: string) => (await apiClient.get<ApiResponse<PickFamilyPreview>>(`${BASE}/preview`, { params: { familyLabel } })).data.data,
  apply: async (b: { familyLabel: string; rate: string; currency: Currency; itemIds: string[] }) =>
    (await apiClient.post<ApiResponse<{ updated: number }>>(`${BASE}/apply`, { familyLabel: b.familyLabel, rate: b.rate, currency: b.currency, itemIds: b.itemIds })).data,
};
