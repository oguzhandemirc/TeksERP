// Maliyet kartları (`/api/cost/items…`, `/api/cost/structures/:itemId`, `/api/cost/preview`). Süzme ve özet
// SUNUCUDA (tek where); önizleme YAZMAZ. Gövdeler açık alan listesiyle kurulur.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { Currency } from "@/pages/Finance/service";
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
export type CostStructure = Record<StructureKey, string | number | null> & {
  finishingRateCode: string | null; extraCostLabel: string | null; notes: string | null;
  /** SY-G1 ek işlemler (sunucu sırasıyla). Eski sunucu göndermez → boş liste sayılır. */
  processes?: Array<{ rateCode: string; sortOrder: number }>;
  /** SY-D2 atkı ücreti çifti (eski sunucu göndermez). */
  loomPickRate?: string | number | null; loomPickCurrency?: Currency | null;
};
/** `processes` verilmezse sunucu ek işlemlere DOKUNMAZ; verilirse sıralı tam küme. */
export type StructureBody = Record<StructureKey, string | null> & {
  finishingRateCode: string | null; extraCostLabel: string | null; notes: string | null; processes?: string[];
  /** Verilmezse sunucu atkı ücreti çiftine DOKUNMAZ (alan çizilmeyen kurulumda gövde bayt-aynı). */
  loomPick?: { rate: string | null; currency: Currency | null };
};

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
  if (v.loomPick) out.loomPick = { rate: v.loomPick.rate ?? null, currency: v.loomPick.currency ?? null };
  if (Array.isArray(v.processes)) out.processes = v.processes.filter((c): c is string => typeof c === "string" && c.length > 0);
  return out;
}

/** Tel gövdesi: `loomPick` çifti düz `loomPickRate/loomPickCurrency` alanlarına açılır; yoksa hiç yazılmaz. */
export function structureWireBody(v: StructureBody): Record<string, unknown> {
  const { loomPick, ...rest } = buildStructureBody(v);
  return loomPick ? { ...rest, loomPickRate: loomPick.rate, loomPickCurrency: loomPick.currency } : rest;
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
  /** `recipeId` yoksa sorgu parametresi YOK → desen geneli zinciri (bugünkü istek bayt-aynı). */
  versions: async (itemId: string, recipeId: string | null = null) =>
    (await apiClient.get<ApiResponse<CostVersion[]>>(`/api/cost/items/${itemId}/versions`, recipeId ? { params: { recipeId } } : undefined)).data.data,
  version: async (itemId: string, versionId: string) =>
    (await apiClient.get<ApiResponse<CostVersion>>(`/api/cost/items/${itemId}/versions/${versionId}`)).data.data,
  saveVersion: async (itemId: string, body: { reason?: string; fxRates?: FxRates; recipeId?: string | null }) =>
    (await apiClient.post<ApiResponse<CostVersion>>(`/api/cost/items/${itemId}/versions`, {
      reason: body.reason, fxRates: body.fxRates, ...(body.recipeId ? { recipeId: body.recipeId } : {}),
    })).data,
  restore: async (itemId: string, versionId: string, reason?: string) =>
    (await apiClient.post<ApiResponse<CostVersion>>(`/api/cost/items/${itemId}/versions/${versionId}/restore`, { reason })).data,
  putStructure: async (itemId: string, v: StructureBody) =>
    (await apiClient.put<ApiResponse<CostStructure>>(`/api/cost/structures/${itemId}`, structureWireBody(v))).data,
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
