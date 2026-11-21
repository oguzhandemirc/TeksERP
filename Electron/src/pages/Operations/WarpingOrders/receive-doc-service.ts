// =============================================================================
// FASON DEVERE — DÖNÜŞ KABUL BELGESİ API istemcisi (devere ek E2) — `/api/warping-receive-docs`
// =============================================================================
// Önizleme yazmaz; kabul `clientToken` ile MANTIKSAL DENEME başına (`useAttemptToken`). Liste `filter[...]` sarmalı
// bekler, yanıt `{ data, nextCursor, summary }` (liste + özet tek where). Gövde çözümü (okutma) 404'ü sessiz yutar:
// tanımsız gövde hata değil, "yeni gövde" önerisidir.
// =============================================================================
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type { BeamBody } from "@/pages/BeamBodies/types";
import type { DeliveryNoteGroup, WarpingReceiveDoc, WarpingReceiveDocFields, WarpingReceiveDocPreview, WarpingReceiveDocRow, WarpingReceiveDocSummary } from "./receive-doc-types";

const BASE = "/api/warping-receive-docs";
export const WARPING_RECEIVE_DOCS_QUERY_KEY = "warping-receive-docs";
export const WARPING_RECEIVE_DOCS_PATH = "/operations/devere-donus";
export const warpingReceiveDocPath = (id: string) => `${WARPING_RECEIVE_DOCS_PATH}/${id}`;

/** Backend `FILTERS` (warping-receive-doc.routes.ts) ile birebir — tanınmayan anahtar 400. */
const LIST_FILTERS = ["subcontractorId", "deliveryNoteNo"] as const;

export type WarpingReceiveDocPage = CursorPaginatedResponse<WarpingReceiveDocRow> & { summary: WarpingReceiveDocSummary | null };

export async function listWarpingReceiveDocs(params: CursorParams): Promise<WarpingReceiveDocPage> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.search) sp.set("search", params.search);
  for (const k of LIST_FILTERS) {
    const v = params.filters[k];
    const csv = Array.isArray(v) ? v.join(",") : v;
    if (csv) sp.set(`filter[${k}]`, csv);
  }
  const r = await apiClient.get<{ success: boolean; data: WarpingReceiveDocRow[]; nextCursor: string | null; summary: WarpingReceiveDocSummary }>(`${BASE}?${sp.toString()}`);
  return {
    success: r.data.success,
    data: r.data.data,
    pagination: { nextCursor: r.data.nextCursor, hasMore: r.data.nextCursor !== null, limit: params.limit, totalEstimate: r.data.summary?.count },
    summary: r.data.summary ?? null,
  };
}

export const warpingReceiveDocService = {
  listCursor: listWarpingReceiveDocs,
  preview: (body: WarpingReceiveDocFields) => apiClient.post<ApiResponse<WarpingReceiveDocPreview>>(`${BASE}/preview`, body).then((r) => r.data.data as WarpingReceiveDocPreview),
  create: (body: WarpingReceiveDocFields & { clientToken: string }) => apiClient.post<ApiResponse<WarpingReceiveDoc>>(BASE, body).then((r) => r.data),
  get: (id: string) => apiClient.get<ApiResponse<WarpingReceiveDoc>>(`${BASE}/${id}`).then((r) => r.data.data as WarpingReceiveDoc),
  byDeliveryNote: (subcontractorId: string, deliveryNoteNo: string) =>
    apiClient.get<ApiResponse<DeliveryNoteGroup>>(`${BASE}/by-delivery-note`, { params: { subcontractorId, deliveryNoteNo }, suppressErrorToast: true }).then((r) => r.data.data as DeliveryNoteGroup),
  /** Gövde okutma: bulunamazsa `null` (tanımsız gövde → satırda "yeni gövde"); diğer hatalar fırlar. */
  resolveBody: async (code: string): Promise<BeamBody | null> => {
    try {
      return (await apiClient.get<ApiResponse<BeamBody>>("/api/beam-bodies/resolve", { params: { code }, suppressErrorToast: true })).data.data as BeamBody;
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) return null;
      throw e;
    }
  },
};

export function useWarpingReceiveDoc(id: string) {
  return useQuery({ queryKey: [WARPING_RECEIVE_DOCS_QUERY_KEY, "doc", id], queryFn: () => warpingReceiveDocService.get(id) });
}

/** Aynı devereci + irsaliye no ile yapılmış kabuller (belgeli + eski); no boşken sorulmaz. */
export function useDeliveryNoteGroup(subcontractorId: string | null, deliveryNoteNo: string, enabled: boolean) {
  const note = deliveryNoteNo.trim();
  return useQuery({
    queryKey: [WARPING_RECEIVE_DOCS_QUERY_KEY, "by-note", subcontractorId, note],
    queryFn: () => warpingReceiveDocService.byDeliveryNote(subcontractorId as string, note),
    enabled: enabled && Boolean(subcontractorId) && note.length > 0,
    staleTime: 10_000,
  });
}
