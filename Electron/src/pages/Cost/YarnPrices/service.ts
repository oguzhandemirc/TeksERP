// İplik maliyet fiyatları (`/api/cost/yarn-prices`). Değiştirmek eski satırı DAMGALAR, yenisini yazar (defter);
// gövde açık alan listesiyle kurulur, fiyat Decimal METNİ gider.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";

export type YarnPriceSource = "MANUAL" | "LAST_RECEIPT" | "PURCHASE_PRICE";
export const YARN_PRICE_SOURCE_LABEL: Record<YarnPriceSource, string> = {
  MANUAL: "Elle",
  LAST_RECEIPT: "Son giriş fiyatı",
  PURCHASE_PRICE: "Kart alış fiyatı",
};

/** SY-a: fiyatın birimi (kartın satın alma biriminden donar; eski sunucuda yok = kg). */
export type YarnPriceUnit = "KG" | "ADET" | "METRE";
const UNIT_SUFFIX: Record<YarnPriceUnit, string> = { KG: "kg", ADET: "adet", METRE: "m" };
/** "USD/kg" · "USD/adet" · "USD/m". */
export const yarnPriceUnitText = (currency: string, unit: YarnPriceUnit | null | undefined): string => `${currency}/${UNIT_SUFFIX[unit ?? "KG"]}`;
/** Fiyat satırının birimi kartın bugünkü birimiyle uyuşmuyor mu (maliyet bu fiyatı okumaz)? */
export const yarnPriceUnitStale = (p: Pick<YarnCostPrice, "unit" | "yarnItem">): boolean => (p.unit ?? "KG") !== (p.yarnItem.yarnPurchaseUnit ?? "KG");

export interface YarnCostPrice {
  id: string; yarnItemId: string; currency: Currency; pricePerKg: string; unit?: YarnPriceUnit; source: YarnPriceSource; sourceRef: string | null;
  note: string | null; revokedAt: string | null; revokeReason: string | null; createdAt: string;
  yarnItem: { id: string; code: string; name: string; linearDensityDen: string | number | null; yarnPurchaseUnit?: YarnPriceUnit | null };
}

export interface YarnPriceInput { yarnItemId: string; currency: Currency; pricePerKg: string; note?: string | null }

export function buildYarnPriceBody(i: YarnPriceInput): YarnPriceInput {
  return { yarnItemId: i.yarnItemId, currency: i.currency, pricePerKg: i.pricePerKg, note: i.note ?? null };
}

const BASE = "/api/cost/yarn-prices";

export const yarnPriceService = {
  listActive: async (search?: string) => (await apiClient.get<ApiResponse<YarnCostPrice[]>>(BASE, { params: search ? { search } : {} })).data.data,
  history: async (yarnItemId: string) =>
    (await apiClient.get<ApiResponse<YarnCostPrice[]>>(BASE, { params: { yarnItemId, includeRevoked: "1" } })).data.data,
  change: async (i: YarnPriceInput) =>
    (await apiClient.post<ApiResponse<YarnCostPrice & { wrote: boolean }>>(BASE, buildYarnPriceBody(i))).data,
  revoke: async (id: string) => (await apiClient.post<ApiResponse<{ id: string }>>(`${BASE}/${id}/revoke`, {})).data,
};
