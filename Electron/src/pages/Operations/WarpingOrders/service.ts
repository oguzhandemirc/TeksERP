// =============================================================================
// FASON DEVERE SİPARİŞİ API İSTEMCİSİ — `/api/warping-orders` (yollar TAM; baseURL `/api` içermez)
// =============================================================================
// Liste ucu `filter[...]` sarmalı bekler (çıplak ad 400 `BARE_FILTER_PARAM`); yanıt `{ data, nextCursor, summary }`
// → `CursorPaginatedResponse`e çevrilir, özet şeridi İLK sayfadan okunur (liste + özet tek where, tek istek).
// =============================================================================
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import apiClient from "@/services/apiClient";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { factoryDayKey } from "@/lib/factory-time";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type { WarpingOrder, WarpingOrderBody, WarpingOrderCancelPreview, WarpingOrderPreview, WarpingOrderRow, WarpingOrderSummary } from "./types";

const BASE = "/api/warping-orders";
export const WARPING_ORDERS_QUERY_KEY = "warping-orders";
export const WARPING_ORDERS_PATH = "/operations/fason-devere";
export const warpingOrderPath = (id: string) => `${WARPING_ORDERS_PATH}/${id}`;

const LIST_FILTERS = ["status", "subcontractorId", "warpSpecId", "salesOrderId", "feeInvoiced"] as const;

export type WarpingOrderPage = CursorPaginatedResponse<WarpingOrderRow> & { summary: WarpingOrderSummary | null };

export async function listWarpingOrders(params: CursorParams): Promise<WarpingOrderPage> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.search) sp.set("search", params.search);
  for (const k of LIST_FILTERS) {
    const v = params.filters[k];
    const csv = Array.isArray(v) ? v.join(",") : v;
    if (csv) sp.set(`filter[${k}]`, csv);
  }
  if (params.dateFrom) sp.set("filter[from]", factoryDayKey(params.dateFrom));
  if (params.dateTo) sp.set("filter[to]", factoryDayKey(params.dateTo));
  const r = await apiClient.get<{ success: boolean; data: WarpingOrderRow[]; nextCursor: string | null; summary: WarpingOrderSummary }>(`${BASE}?${sp.toString()}`);
  return {
    success: r.data.success,
    data: r.data.data,
    pagination: { nextCursor: r.data.nextCursor, hasMore: r.data.nextCursor !== null, limit: params.limit, totalEstimate: r.data.summary?.count },
    summary: r.data.summary ?? null,
  };
}

/** Plan önizlemesi — YAZMAZ; form değiştikçe (~400 ms durulunca) sorulur, hata formda satır içi gösterilir. */
export async function previewWarpingOrder(body: { warpSpecId: string; beamLines?: Array<{ beamCount: number; beamLengthM: number }>; openTargetLengthM?: number; extraWarpSpecIds?: string[]; fixedWasteM?: number }): Promise<ApiResponse<WarpingOrderPreview>> {
  return (await apiClient.post<ApiResponse<WarpingOrderPreview>>(`${BASE}/preview`, body, { suppressErrorToast: true })).data;
}

export const warpingOrderService = {
  listCursor: listWarpingOrders,
  get: (id: string) => apiClient.get<ApiResponse<WarpingOrder>>(`${BASE}/${id}`).then((r) => r.data.data),
  /** `clientToken` MANTIKSAL DENEME başına bir kez (diyalog açılışında üretilir; idempotency). */
  create: (body: WarpingOrderBody, clientToken: string) => apiClient.post<ApiResponse<WarpingOrder>>(BASE, { ...body, clientToken }).then((r) => r.data),
  update: (id: string, body: WarpingOrderBody) => apiClient.patch<ApiResponse<WarpingOrder>>(`${BASE}/${id}`, body).then((r) => r.data),
  cancelPreview: (id: string) => apiClient.get<ApiResponse<WarpingOrderCancelPreview>>(`${BASE}/${id}/cancel-preview`).then((r) => r.data.data),
  cancel: (id: string, reason: string) => apiClient.post<ApiResponse<WarpingOrder>>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data),
};

export const WARPING_PREVIEW_DEBOUNCE_MS = 400;

/** Canlı plan önizlemesi: gövde durulunca tek istek; eski yanıt yenisi gelene dek kalır. */
export function useWarpingPreview(body: Parameters<typeof previewWarpingOrder>[0] | null) {
  const settled = useDebouncedValue(body ? JSON.stringify(body) : null, WARPING_PREVIEW_DEBOUNCE_MS);
  return useQuery({
    queryKey: [WARPING_ORDERS_QUERY_KEY, "preview", settled],
    queryFn: () => previewWarpingOrder(JSON.parse(settled!) as Parameters<typeof previewWarpingOrder>[0]),
    enabled: settled !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });
}

export function useWarpingOrder(id: string | undefined) {
  return useQuery({ queryKey: [WARPING_ORDERS_QUERY_KEY, "detail", id], queryFn: () => warpingOrderService.get(id!), enabled: Boolean(id) });
}
