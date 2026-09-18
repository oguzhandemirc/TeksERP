// =============================================================================
// DOKUMA İŞİ API İSTEMCİSİ
// =============================================================================
// ⚠️ YOLLAR TAM YAZILIR ("/api/weaving-orders") — `apiClient.baseURL` `/api` İÇERMEZ.
//
// ⚠️ LİSTE UCUNUN ŞEMASI `.strict()` ve KENDİ adlarını bekler (`status` CSV ·
// `itemId` CSV · `subcontractorId` · `search` · `cursor` · `limit` · `withTotal`).
// Ortak `buildCursorQueryString` `mode=cursor` ve `filter[...]` yazar → 400.
// Bu yüzden `useDataTable`in `CursorParams`ı burada uca ÇEVRİLİR; sıralama ve
// tarih aralığı gönderilmez (uç en yeni önce sıralar).
//
// ⚠️ Bu dosya dokuma uçlarını çağıran TEK istemci dosyasıdır ve backend bekçisi
// `test_dokuma_regime_gate §7` onu ADIYLA allowlist'te tutar: çağıran ekranın
// karosu `dokumaEnabled`e bağlı olmak zorunda. Başka bir dosyadan çağırmak
// bekçiyi kırmızıya düşürür — istenen budur (kapalı modülde istek atan yüzey yok).
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type { CrudService } from "@/services/crudService";
import type { WeavingExecutionKind, WeavingOrder } from "./types";

const BASE = "/api/weaving-orders";

function csv(v: string | string[] | undefined): string | undefined {
  if (!v || (Array.isArray(v) && v.length === 0)) return undefined;
  return Array.isArray(v) ? v.join(",") : v;
}

/** `useDataTable` → uç sözleşmesi (yalnız ucun TANIDIĞI anahtarlar gider). */
export function listWeavingOrders(params: CursorParams): Promise<CursorPaginatedResponse<WeavingOrder>> {
  const sp = new URLSearchParams();
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.withTotal) sp.set("withTotal", "true");
  if (params.search) sp.set("search", params.search);
  const status = csv(params.filters.status);
  const itemId = csv(params.filters.itemId);
  const sub = csv(params.filters.subcontractorId);
  // Z1 (01): sipariş / sipariş satırı süzgeçleri (`filter[orderId]` · `filter[orderLineId]`).
  const orderId = csv(params.filters.orderId);
  const orderLineId = csv(params.filters.orderLineId);
  if (status) sp.set("status", status);
  if (itemId) sp.set("itemId", itemId);
  if (sub) sp.set("subcontractorId", sub);
  // Dokuma işi ucu DÜZ query okur (`orderId=` · `orderLineId=`; 01 sözleşmesi, route zod) — levent ucundaki `filter[weavingOrderId]`ten farklı.
  if (orderId) sp.set("orderId", orderId);
  if (orderLineId) sp.set("orderLineId", orderLineId);
  return apiClient.get<CursorPaginatedResponse<WeavingOrder>>(`${BASE}?${sp.toString()}`).then((r) => r.data);
}

export interface WeavingOrderPayload {
  itemId: string;
  colorId: string | null;
  warpSpecId: string | null;
  plannedM: number | null;
  executionKind: WeavingExecutionKind;
  subcontractorId: string | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  notes: string | null;
  /** Z1 (01): küme REPLACE — gönderilen dizi bağların tamamıdır; `[]` bağsız. */
  orderLines?: Array<{ orderLineId: string; allocatedM: number | null }>;
}

export const weavingOrderService = {
  listCursor: listWeavingOrders,
  getById: (id: string) => apiClient.get<ApiResponse<WeavingOrder>>(`${BASE}/${id}`).then((r) => r.data),
  /** `clientToken` MANTIKSAL DENEME başına bir kez üretilir (idempotency). */
  create: (body: WeavingOrderPayload, clientToken: string) =>
    apiClient.post<ApiResponse<WeavingOrder>>(BASE, { ...body, clientToken }).then((r) => r.data),
  update: (id: string, body: Partial<WeavingOrderPayload>) =>
    apiClient.patch<ApiResponse<WeavingOrder>>(`${BASE}/${id}`, body).then((r) => r.data),
  /** Kapanış AÇIK BİR KARARDIR; açık koşum varsa 409 koşumları ADIYLA döner. */
  close: (id: string) => apiClient.post<ApiResponse<WeavingOrder>>(`${BASE}/${id}/close`, {}).then((r) => r.data),
  /** İptal yalnız durum geçişidir; koşum/duruş/doff defterlerine dokunmaz. Sebep zorunlu. */
  cancel: (id: string, reason: string) =>
    apiClient.post<ApiResponse<WeavingOrder>>(`${BASE}/${id}/cancel`, { reason }).then((r) => r.data),
};

/** Seçici adaptörü: `EntityPickerModal` yalnız `listCursor` + `getById` çağırır (ölçüldü) — CRUD'un kalanı gerekmez. */
export const weavingOrderPickerService = weavingOrderService as unknown as CrudService<WeavingOrder>;
