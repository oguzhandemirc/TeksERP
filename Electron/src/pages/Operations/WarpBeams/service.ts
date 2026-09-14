// =============================================================================
// LEVENT API İSTEMCİSİ — `/api/warp-beams` (yollar TAM yazılır; baseURL `/api` içermez)
// =============================================================================
// Liste ucu `.strict()` ve KENDİ adlarını bekler (status CSV · warpSpecId · originKind ·
// search · cursor · limit · withTotal) — `CursorParams` burada uca ÇEVRİLİR.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type { CancelWoundPreview, WarpBeam, WarpBeamEvent, WarpBeamMountMethod, WarpBeamOrigin, WarpBeamStatus, WarpKgSource, WarpLengthSource } from "./types";

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
  /** Raşel takımı (#23): N adet → N−1 kardeş aynı işlemde; 1 ise gönderilmez. */
  count?: number;
  physicalBeamNoPrefix?: string | null;
}

export interface DevereMachine {
  id: string;
  code: string;
  name: string;
  stationName: string;
}

export interface LoomMachine extends DevereMachine {
  warpBeamSlots: number;
}
/** Faz 3 gövdeleri — route Zod'u ile birebir (`.strict()`; bilinmeyen anahtar 400). */
export interface MountPayload { machineId: string; position: number; mountMethod?: WarpBeamMountMethod | null; beamRole?: string | null; setupStartedAt?: string | null; setupMinutes?: number | null; machineCounter?: number | null; clientToken: string }
export interface DismountPayload { remainingM?: number | null; lengthSource?: WarpLengthSource | null; machineCounter?: number | null; reason?: string | null }
export interface ConsumePayload { lengthM: number; lengthSource: WarpLengthSource; machineCounter?: number | null; fabricLengthM?: number | null; grossKg?: number | null; tareKg?: number | null; reason?: string | null; clientToken: string }
export interface AdjustPayload { direction: "IN" | "OUT"; lengthM: number; reasonCode: string; reason?: string | null; lengthSource?: WarpLengthSource | null }
export interface ExhaustPayload { residualM?: number | null; grossKg?: number | null; tareKg?: number | null; lengthSource?: WarpLengthSource | null; reasonCode?: string | null; reason?: string | null; machineCounter?: number | null }
export interface ScrapPreview { beamNo: string; status: WarpBeamStatus; remainingM: number; currentMachine: { id: string; code: string; name: string } | null; currentPosition: number | null; openRunsOnMachine: number }

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
  wind: (id: string, body: WindPayload) => apiClient.post<ApiResponse<WarpBeam & { siblings: Array<{ id: string; beamNo: string }> }>>(`${BASE}/${id}/wind`, body).then((r) => r.data),
  cancelPreview: (id: string) => apiClient.get<ApiResponse<CancelWoundPreview>>(`${BASE}/${id}/cancel-preview`).then((r) => r.data),
  cancel: (id: string, reason: string) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data),
  // ── Faz 3 tezgah bağı ──
  loomMachines: () => apiClient.get<ApiResponse<LoomMachine[]>>(`${BASE}/loom-machines`).then((r) => r.data),
  mount: (id: string, body: MountPayload) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/mount`, body).then((r) => r.data),
  dismount: (id: string, body: DismountPayload) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/dismount`, body).then((r) => r.data),
  consume: (id: string, body: ConsumePayload) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/consume`, body).then((r) => r.data),
  adjust: (id: string, body: AdjustPayload) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/adjust`, body).then((r) => r.data),
  exhaust: (id: string, body: ExhaustPayload) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/exhaust`, body).then((r) => r.data),
  scrapPreview: (id: string) => apiClient.get<ApiResponse<ScrapPreview>>(`${BASE}/${id}/scrap-preview`).then((r) => r.data),
  scrap: (id: string, reasonCode: string, reason: string | null) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/scrap`, { reasonCode, reason }).then((r) => r.data),
  /** LIFO: yalnız en yeni aktif DURUM olayı (MOUNTED · DISMOUNTED · EXHAUSTED · SCRAPPED) geri alınır. */
  cancelEvent: (id: string, eventId: string, reason: string) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/events/${eventId}/cancel`, { reason }).then((r) => r.data),
  cancelConsumed: (id: string, eventId: string, reason: string) => apiClient.post<ApiResponse<WarpBeam>>(`${BASE}/${id}/consumed/${eventId}/cancel`, { reason }).then((r) => r.data),
};
