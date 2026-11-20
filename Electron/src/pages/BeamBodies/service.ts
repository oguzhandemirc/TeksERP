// =============================================================================
// LEVENT GÖVDESİ API İSTEMCİSİ — `/api/beam-bodies` · `/api/beam-body-returns` (devere ek B4)
// =============================================================================
// Liste ucu `filter[...]` sarmalı bekler; yanıt `{ data, nextCursor, summary }` — özet şeridi İLK sayfadan
// (liste + özet tek where, tek istek). `devere.beamBodyMode=OFF`ta bütün uçlar 403 `BEAM_BODY_MODE_OFF`.
// =============================================================================
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { loadAllCursorPagesForPicker } from "@/lib/picker-loader";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type {
  BeamBody,
  BeamBodyCancelRegistrationPreview,
  BeamBodyCreateBody,
  BeamBodyEvent,
  BeamBodyPatchBody,
  BeamBodyReturnCancelPreview,
  BeamBodyReturnCreateBody,
  BeamBodyReturnDoc,
  BeamBodySummary,
  BeamBodyTransitionInput,
  BeamBodyTransitionPlan,
  BeamBodyUndoPreview,
  OwnerReturnCandidateGroup,
} from "./types";

const BASE = "/api/beam-bodies";
const RETURNS = "/api/beam-body-returns";
export const BEAM_BODIES_QUERY_KEY = "beam-bodies";
export const BEAM_BODY_RETURNS_QUERY_KEY = "beam-body-returns";
export const BEAM_BODIES_PATH = "/definitions/beam-bodies";
export const beamBodyPath = (id: string) => `${BEAM_BODIES_PATH}/${id}`;

/** Backend `FILTERS` (beam-body.routes.ts) ile birebir — tanınmayan anahtar 400. */
export const BEAM_BODY_LIST_FILTERS = ["owner", "ownerCustomerId", "status", "subcontractorId", "machineId", "warehouseId", "ownerReturnDue", "active"] as const;

export type BeamBodyPage = CursorPaginatedResponse<BeamBody> & { summary: BeamBodySummary | null };

function filterQuery(params: Pick<CursorParams, "filters" | "search" | "cursor" | "limit">, keys: readonly string[]): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.search) sp.set("search", params.search);
  for (const k of keys) {
    const v = params.filters[k];
    const csv = Array.isArray(v) ? v.join(",") : v;
    if (csv) sp.set(`filter[${k}]`, csv);
  }
  return sp;
}

export async function listBeamBodies(params: CursorParams): Promise<BeamBodyPage> {
  const sp = filterQuery(params, BEAM_BODY_LIST_FILTERS);
  const r = await apiClient.get<{ success: boolean; data: BeamBody[]; nextCursor: string | null; summary: BeamBodySummary }>(`${BASE}?${sp.toString()}`);
  return {
    success: r.data.success,
    data: r.data.data,
    pagination: { nextCursor: r.data.nextCursor, hasMore: r.data.nextCursor !== null, limit: params.limit, totalEstimate: r.data.summary?.count },
    summary: r.data.summary ?? null,
  };
}

const data = <T>(p: Promise<{ data: ApiResponse<T> }>): Promise<T> => p.then((r) => r.data.data as T);

export const beamBodyService = {
  listCursor: listBeamBodies,
  get: (id: string) => data<BeamBody>(apiClient.get(`${BASE}/${id}`)),
  events: (id: string) => data<BeamBodyEvent[]>(apiClient.get(`${BASE}/${id}/events`)),
  resolve: (code: string) => data<BeamBody>(apiClient.get(`${BASE}/resolve`, { params: { code } })),
  /** `clientToken` MANTIKSAL DENEME başına (`useAttemptToken`). */
  create: (body: BeamBodyCreateBody, clientToken: string) => apiClient.post<ApiResponse<BeamBody>>(BASE, { ...body, clientToken }).then((r) => r.data),
  update: (id: string, body: BeamBodyPatchBody) => apiClient.patch<ApiResponse<BeamBody>>(`${BASE}/${id}`, body).then((r) => r.data),
  /** Önizleme YAZMAZ; hata diyalogda satır içi gösterilir (genel toast basılmaz). */
  transitionPreview: (id: string, body: BeamBodyTransitionInput) =>
    data<BeamBodyTransitionPlan>(apiClient.post(`${BASE}/${id}/transition-preview`, body, { suppressErrorToast: true })),
  transition: (id: string, body: BeamBodyTransitionInput) => apiClient.post<ApiResponse<{ body: BeamBody; warnings: string[] }>>(`${BASE}/${id}/transition`, body).then((r) => r.data),
  undoPreview: (id: string, eventId: string) => data<BeamBodyUndoPreview>(apiClient.get(`${BASE}/${id}/events/${eventId}/undo-preview`)),
  undo: (id: string, eventId: string, reason: string) => apiClient.post<ApiResponse<BeamBody>>(`${BASE}/${id}/events/${eventId}/undo`, { reason }).then((r) => r.data),
  cancelRegistrationPreview: (id: string) => data<BeamBodyCancelRegistrationPreview>(apiClient.get(`${BASE}/${id}/cancel-registration/preview`)),
  cancelRegistration: (id: string, reason: string) => apiClient.post<ApiResponse<BeamBody>>(`${BASE}/${id}/cancel-registration`, { reason }).then((r) => r.data),
};

/** Seçici için tam liste (ör. sevkte "Depoda boş" gövdeler) — süzme sunucuda, sayfalar ortak yükleyiciden. */
export function listBeamBodiesForPicker(filters: Record<string, string>, search?: string): Promise<BeamBody[]> {
  return loadAllCursorPagesForPicker((cursor, limit) => listBeamBodies({ cursor, limit, filters, search }));
}

export const beamBodyReturnService = {
  candidates: (ownerCustomerId?: string | null) =>
    data<OwnerReturnCandidateGroup[]>(apiClient.get(`${RETURNS}/candidates`, { params: ownerCustomerId ? { "filter[ownerCustomerId]": ownerCustomerId } : {} })),
  list: async (params: CursorParams): Promise<CursorPaginatedResponse<BeamBodyReturnDoc> & { summary: { count: number; bodyCount: number } | null }> => {
    const sp = filterQuery(params, ["ownerCustomerId", "status"]);
    const r = await apiClient.get<{ success: boolean; data: BeamBodyReturnDoc[]; nextCursor: string | null; summary: { count: number; bodyCount: number } }>(`${RETURNS}?${sp.toString()}`);
    return {
      success: r.data.success,
      data: r.data.data,
      pagination: { nextCursor: r.data.nextCursor, hasMore: r.data.nextCursor !== null, limit: params.limit, totalEstimate: r.data.summary?.count },
      summary: r.data.summary ?? null,
    };
  },
  get: (id: string) => data<BeamBodyReturnDoc>(apiClient.get(`${RETURNS}/${id}`)),
  create: (body: BeamBodyReturnCreateBody, clientToken: string) => apiClient.post<ApiResponse<BeamBodyReturnDoc>>(RETURNS, { ...body, clientToken }).then((r) => r.data),
  cancelPreview: (id: string) => data<BeamBodyReturnCancelPreview>(apiClient.get(`${RETURNS}/${id}/cancel-preview`)),
  cancel: (id: string, reason: string) => apiClient.post<ApiResponse<BeamBodyReturnDoc>>(`${RETURNS}/${id}/cancel`, { reason }).then((r) => r.data),
};

export function useBeamBody(id: string | undefined) {
  return useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "detail", id], queryFn: () => beamBodyService.get(id!), enabled: Boolean(id) });
}

export function useBeamBodyEvents(id: string | undefined) {
  return useQuery({ queryKey: [BEAM_BODIES_QUERY_KEY, "events", id], queryFn: () => beamBodyService.events(id!), enabled: Boolean(id) });
}
