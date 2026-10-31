// Maliyet kartları (`/api/cost/items…`, `/api/cost/structures/:itemId`, `/api/cost/preview`). Süzme ve özet
// SUNUCUDA (tek where); önizleme YAZMAZ. Gövdeler açık alan listesiyle kurulur.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { CostInputSnap, CostPresentationFields, CostPreview, CostVersion, FxRates, StructureStatus } from "../shared/cost-types";

export interface CostItemRow {
  itemId: string; kod: string; ad: string; yapiDurumu: StructureStatus; eksikler: string[]; uyarilar: string[];
  aktifSurum: ({ id: string; surumNo: number; standartTlM: string; hesaplananAt: string } & CostPresentationFields) | null; girdiDegisti: boolean;
}
export interface CostItemSummary { toplam: number; TAM: number; VARSAYILAN: number; YAPI_EKSIK: number; girdiDegisti: number; surumsuz: number }
export interface CostItemPage { data: CostItemRow[]; ozet: CostItemSummary; toplamSuzulen: number; nextCursor: string | null }
export interface CostItemFilter { q: string; durum: StructureStatus | ""; girdiDegisti: boolean }

export const STRUCTURE_KEYS = [
  "loomRpm", "efficiencyPct", "warpWastePct", "weftWastePct", "fabricWastePct", "weftLengthCm", "beamLengthM",
  "lengthShrinkPct", "extraCostPerMTry",
] as const;
export type StructureKey = (typeof STRUCTURE_KEYS)[number];
export type CostStructure = Record<StructureKey, string | number | null> & { finishingRateCode: string | null; extraCostLabel: string | null; notes: string | null };
export type StructureBody = Record<StructureKey, string | null> & { finishingRateCode: string | null; extraCostLabel: string | null; notes: string | null };

export interface CostItemDetail {
  urun: { id: string; kod: string; ad: string };
  yapi: CostStructure | null;
  girdi: CostInputSnap;
  yapiDurumu: StructureStatus;
  eksikler: string[];
  uyarilar: string[];
  aktifSurum: CostVersion | null;
  girdiDegisti: boolean;
}

/** Tam küme (PUT): bilinmeyen alan gönderilmez; boş alan null = parametre varsayılanı. */
export function buildStructureBody(v: StructureBody): StructureBody {
  const out = {} as StructureBody;
  for (const k of STRUCTURE_KEYS) out[k] = v[k] ?? null;
  out.finishingRateCode = v.finishingRateCode ?? null;
  out.extraCostLabel = v.extraCostLabel ?? null;
  out.notes = v.notes ?? null;
  return out;
}

export function listParams(f: CostItemFilter, cursor: string | null, limit: number): Record<string, string> {
  return {
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.durum ? { "filter[durum]": f.durum } : {}),
    ...(f.girdiDegisti ? { girdiDegisti: "1" } : {}),
    ...(cursor ? { cursor } : {}),
    limit: String(limit),
  };
}

export const costItemService = {
  list: async (f: CostItemFilter, cursor: string | null, limit = 50) =>
    (await apiClient.get<ApiResponse<CostItemRow[]> & CostItemPage>("/api/cost/items", { params: listParams(f, cursor, limit) })).data as CostItemPage,
  detail: async (itemId: string) => (await apiClient.get<ApiResponse<CostItemDetail>>(`/api/cost/items/${itemId}`)).data.data,
  versions: async (itemId: string) => (await apiClient.get<ApiResponse<CostVersion[]>>(`/api/cost/items/${itemId}/versions`)).data.data,
  saveVersion: async (itemId: string, body: { reason?: string; fxRates?: FxRates }) =>
    (await apiClient.post<ApiResponse<CostVersion>>(`/api/cost/items/${itemId}/versions`, { reason: body.reason, fxRates: body.fxRates })).data,
  restore: async (itemId: string, versionId: string, reason?: string) =>
    (await apiClient.post<ApiResponse<CostVersion>>(`/api/cost/items/${itemId}/versions/${versionId}/restore`, { reason })).data,
  putStructure: async (itemId: string, v: StructureBody) =>
    (await apiClient.put<ApiResponse<CostStructure>>(`/api/cost/structures/${itemId}`, buildStructureBody(v))).data,
};

export interface PreviewBody {
  itemId?: string;
  adHoc?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  fxRates?: FxRates;
}

export async function previewCost(b: PreviewBody): Promise<CostPreview> {
  const body: PreviewBody = {
    ...(b.itemId ? { itemId: b.itemId } : {}),
    ...(b.adHoc ? { adHoc: b.adHoc } : {}),
    ...(b.overrides && Object.keys(b.overrides).length ? { overrides: b.overrides } : {}),
    ...(b.fxRates && Object.keys(b.fxRates).length ? { fxRates: b.fxRates } : {}),
  };
  return (await apiClient.post<ApiResponse<CostPreview>>("/api/cost/preview", body)).data.data;
}
