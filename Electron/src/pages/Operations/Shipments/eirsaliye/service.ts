// e-İrsaliye uçları (`/api/e-irsaliye`, E5 + E7). Uç başına tek fonksiyon; hata cümlesi
// backend'den (`apiErrorText`), kod `details.code`tan okunur (`body.code` hep undefined).
// Kart sorguları genel hata toast'ını bastırır: eski backend 404'ü kartı sessizce düşürür.
import axios from "axios";
import apiClient from "@/services/apiClient";
import { buildCursorQueryString } from "@/lib/query-builder";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";
import type {
  EIrsaliyeDownload, EIrsaliyeFields, EIrsaliyeListItem, EIrsaliyePreview, EIrsaliyeReadiness,
  EIrsaliyeRecord, EIrsaliyeResponseStatus, EIrsaliyeSummary, EIrsaliyeValidationIssue, ShipmentEIrsaliye,
} from "./types";

const BASE = "/api/e-irsaliye";
const QUIET = { suppressErrorToast: true } as const;
const data = <T>(r: { data: ApiResponse<T> }): T => r.data.data as T;

/** Hata gövdesindeki `details.code` — yoksa null. */
export function eIrsaliyeErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  const code = (error.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof code === "string" ? code : null;
}

/** `EIRSALIYE_VALIDATION` ayrıntısındaki alan alan hatalar (yoksa boş). */
export function eIrsaliyeValidationIssues(error: unknown): EIrsaliyeValidationIssue[] {
  if (eIrsaliyeErrorCode(error) !== "EIRSALIYE_VALIDATION" || !axios.isAxiosError(error)) return [];
  const list = (error.response?.data as { details?: { hatalar?: unknown } }).details?.hatalar;
  return Array.isArray(list) ? (list as EIrsaliyeValidationIssue[]) : [];
}

/** Uç bu sunucuda yok (eski backend) ya da kullanıcıya kapalı → kart hiç çizilmez. */
export function isEIrsaliyeUnavailable(error: unknown): boolean {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  return status === 404 || status === 403;
}

export const eIrsaliyeService = {
  readiness: () => apiClient.get<ApiResponse<EIrsaliyeReadiness>>(`${BASE}/readiness`, QUIET).then(data),
  byShipment: (shipmentId: string) =>
    apiClient.get<ApiResponse<ShipmentEIrsaliye>>(`${BASE}/by-shipment/${shipmentId}`, QUIET).then(data),
  prepare: (shipmentId: string, fields: EIrsaliyeFields, clientToken: string) =>
    apiClient
      .post<ApiResponse<{ created: boolean; kayit: EIrsaliyeRecord }>>(`${BASE}/by-shipment/${shipmentId}`, { ...fields, clientToken }, QUIET)
      .then(data),
  updateFields: (id: string, fields: EIrsaliyeFields) =>
    apiClient.patch<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}`, fields, QUIET).then(data),
  generate: (id: string) =>
    apiClient.post<ApiResponse<{ kayit: EIrsaliyeRecord; xmlVersion: number }>>(`${BASE}/${id}/generate`, {}, QUIET).then(data),
  regenerate: (id: string, onay: boolean) =>
    apiClient
      .post<ApiResponse<{ kayit: EIrsaliyeRecord; xmlVersion: number }>>(`${BASE}/${id}/regenerate`, { onay }, QUIET)
      .then(data),
  download: (id: string) => apiClient.post<ApiResponse<EIrsaliyeDownload>>(`${BASE}/${id}/download`, {}).then(data),
  send: (id: string) => apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/send`, {}).then(data),
  poll: (id: string) => apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/poll`, {}).then(data),
  markSent: (id: string, body: { confirmedEttn: string | null; confirmedNo: string | null }) =>
    apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/mark-sent`, body, QUIET).then(data),
  recordResponse: (id: string, body: { durum: EIrsaliyeResponseStatus; not: string | null }) =>
    apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/response`, body, QUIET).then(data),
  undoPreview: (id: string) => apiClient.get<ApiResponse<EIrsaliyePreview>>(`${BASE}/${id}/undo-preview`, QUIET).then(data),
  undoSent: (id: string) => apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/undo-sent`, {}, QUIET).then(data),
  undoResponse: (id: string) => apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/undo-response`, {}, QUIET).then(data),
  cancelPreview: (id: string) => apiClient.get<ApiResponse<EIrsaliyePreview>>(`${BASE}/${id}/cancel-preview`, QUIET).then(data),
  cancel: (id: string) => apiClient.post<ApiResponse<EIrsaliyeRecord>>(`${BASE}/${id}/cancel`, {}, QUIET).then(data),

  /** Kayıtlar listesi — cursor; süzme sunucuda (`filter[status]`, `filter[adapter]`, `search`). */
  listCursor: (params: CursorParams) =>
    apiClient.get<CursorPaginatedResponse<EIrsaliyeListItem>>(`${BASE}${buildCursorQueryString(params)}`).then((r) => r.data),
  /** Özet şeridi — listeyle aynı süzgeç (sunucuda tek where). */
  summary: (params: Pick<CursorParams, "search" | "filters">) =>
    apiClient
      .get<ApiResponse<EIrsaliyeSummary>>(`${BASE}/summary${buildCursorQueryString({ ...params, limit: 1 })}`)
      .then(data),
};
