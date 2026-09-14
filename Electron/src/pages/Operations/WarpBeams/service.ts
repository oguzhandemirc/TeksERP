// =============================================================================
// LEVENT API İSTEMCİSİ — `/api/warp-beams` (yollar TAM yazılır; baseURL `/api` içermez)
// =============================================================================
// Liste ucu `.strict()` ve KENDİ adlarını bekler (status CSV · warpSpecId · originKind ·
// search · cursor · limit · withTotal) — `CursorParams` burada uca ÇEVRİLİR.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type { CancelWoundPreview, WarpBeam, WarpBeamEvent, WarpBeamOrigin, WarpKgSource } from "./types";

const BASE = "/api/warp-beams";

function csv(v: string | string[] | undefined): string | undefined {
  if (!v || (Array.isArray(v) && v.length === 0)) return undefined;
  return Array.isArray(v) ? v.join(",") : v;
}

export function listWarpBeams(params: CursorParams): Promise<CursorPaginatedResponse<WarpBeam>> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.withTotal) sp.set("withTotal", "true");
  if (params.search) sp.set("search", params.search);
  const status = csv(params.filters.status);
  const warpSpecId = csv(params.filters.warpSpecId);
  const originKind = csv(params.filters.originKind);
  if (status) sp.set("status", status);
  if (warpSpecId) sp.set("warpSpecId", warpSpecId);
  if (originKind) sp.set("originKind", originKind);
  return apiClient.get<CursorPaginatedResponse<WarpBeam>>(`${BASE}?${sp.toString()}`).then((r) => r.data);
}

export interface WarpBeamPlanPayload {
  warpSpecId: string;
  plannedLengthM: number;
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  physicalBeamNo: string | null;
  notes: string | null;
}

export interface YarnLinePayload {
  warehouseId: string;
  qtyKg: number;
  /** Devere Faz 2: lot etiketi; null = lotsuz (sunucu uyarır / lotRequired açıksa 400). */
  lotId: string | null;
}

export interface WindPayload {
  lengthM: number;
  kgSource: WarpKgSource;
  machineId: string | null;
  yarnIssues?: YarnLinePayload[];
  yarnReturns?: Array<YarnLinePayload & { reasonCode: string }>;
  breakCount?: number | null;
  clientToken: string;
}

export interface DevereMachine {
  id: string;
  code: string;
  name: string;
  stationName: string;
}

export type WarpBeamDetail = WarpBeam & { events: WarpBeamEvent[]; yarnLines: Array<{ id: string; kind: string; qtyKg: number; warehouse: { id: string; name: string }; reasonCode: string | null; createdAt: string }> };

export const warpBeamService = {
  listCursor: listWarpBeams,
  getById: (id: string) => apiClient.get<ApiResponse<WarpBeamDetail>>(`${BASE}/${id}`).then((r) => r.data),
  devereMachines: () => apiClient.get<ApiResponse<DevereMachine[]>>(`${BASE}/devere-machines`).then((r) => r.data),
  /** `clientToken` MANTIKSAL DENEME başına bir kez (idempotency). */
  create: (body: WarpBeamPlanPayload, clientToken: string) => apiClient.post<ApiResponse<WarpBeam>>(BASE, { ...body, clientToken }).then((r) => r.data),
  update: (id: string, body: Partial<WarpBeamPlanPayload>) => apiClient.patch<ApiResponse<WarpBeam>>(`${BASE}/${id}`, body).then((r) => r.data),
  /** ④ sınıfı: yalnız PLANNED taslak silinir; sarılmış levent iptal edilir. */
  deleteDraft: (id: string) => apiClient.delete<ApiResponse<{ id: string }>>(`${BASE}/${id}`).then((r) => r.data),
  wind: (id: string, body: WindPayload) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/wind`, body).then((r) => r.data),
  cancelPreview: (id: string) => apiClient.get<ApiResponse<CancelWoundPreview>>(`${BASE}/${id}/cancel-preview`).then((r) => r.data),
  cancel: (id: string, reason: string) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data),
};
