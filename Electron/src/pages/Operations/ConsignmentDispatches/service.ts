// EMANET ÇIKIŞ (F5) — `/api/consignment-dispatches` istemcisi. Yollar TAM (`/api` öneki; baseURL içermez).
// Kapı sırası sunucuda: oturum → emanet modülü (403 MODULE_DISABLED) → `consignment:*` izni.
import apiClient from "@/services/apiClient";
import type {
  ConsignmentCandidates,
  ConsignmentDispatchCancelPreview,
  ConsignmentDispatchCreateInput,
  ConsignmentDispatchDto,
  ConsignmentDispatchListFilter,
  ConsignmentDispatchListResult,
  ConsignmentDispatchPreview,
} from "./types";

const BASE = "/api/consignment-dispatches";
export const CONSIGNMENT_DISPATCHES_QUERY_KEY = "consignment-dispatches";

/** Süzgeç → sorgu parametreleri. Süzme SUNUCUDA (liste + cursor + özet şeridi tek where); boş alan gönderilmez. */
export function listParams(
  f: ConsignmentDispatchListFilter,
  cursor: string | null,
  limit: number,
): Record<string, string> {
  const p: Record<string, string> = { "filter[status]": f.status, limit: String(limit) };
  if (f.ownerCustomerId) p["filter[ownerCustomerId]"] = f.ownerCustomerId;
  if (f.from) p["filter[from]"] = f.from;
  if (f.to) p["filter[to]"] = f.to;
  if (f.search.trim()) p.search = f.search.trim();
  if (cursor) p.cursor = cursor;
  return p;
}

export async function listConsignmentDispatches(
  f: ConsignmentDispatchListFilter,
  cursor: string | null,
  limit: number,
): Promise<ConsignmentDispatchListResult> {
  const r = await apiClient.get<ConsignmentDispatchListResult>(BASE, {
    params: listParams(f, cursor, limit),
  });
  return r.data;
}

export async function getConsignmentDispatch(id: string): Promise<ConsignmentDispatchDto> {
  const r = await apiClient.get<{ data: ConsignmentDispatchDto }>(`${BASE}/${id}`);
  return r.data.data;
}

/** Yazmaz; engelli kalem `blockedReason` taşır. Token gönderilmez (sunucu yok sayar). */
export async function previewConsignmentDispatch(
  body: Omit<ConsignmentDispatchCreateInput, "clientToken">,
): Promise<ConsignmentDispatchPreview> {
  const r = await apiClient.post<{ data: ConsignmentDispatchPreview }>(`${BASE}/preview`, body);
  return r.data.data;
}

/** 201 yeni belge · 200 replay (aynı token aynı belge). Token mantıksal deneme başına (`useAttemptToken`). */
export async function createConsignmentDispatch(
  body: ConsignmentDispatchCreateInput & { clientToken: string },
): Promise<ConsignmentDispatchDto> {
  const r = await apiClient.post<{ data: ConsignmentDispatchDto }>(BASE, body);
  return r.data.data;
}

export async function getConsignmentCancelPreview(id: string): Promise<ConsignmentDispatchCancelPreview> {
  const r = await apiClient.get<{ data: ConsignmentDispatchCancelPreview }>(`${BASE}/${id}/cancel-preview`);
  return r.data.data;
}

export async function cancelConsignmentDispatch(id: string, reason: string): Promise<ConsignmentDispatchDto> {
  const r = await apiClient.post<{ data: ConsignmentDispatchDto }>(`${BASE}/${id}/cancel`, { reason });
  return r.data.data;
}

/** Sahibin çıkabilecek leventleri + lot × depo bakiyeleri. Sahip süzgeci ve tavan sunucuda; izin `consignment:write`. */
export async function listConsignmentCandidates(ownerCustomerId: string, search: string): Promise<ConsignmentCandidates> {
  const params: Record<string, string> = { ownerCustomerId };
  if (search.trim()) params.search = search.trim();
  const r = await apiClient.get<{ data: ConsignmentCandidates }>(`${BASE}/candidates`, { params });
  return r.data.data;
}
