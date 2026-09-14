// =============================================================================
// FASON DOKUMA (G2p) — servis: `/api/subcontractor-weaving` (requireDokumaEnabled)
// =============================================================================
// Dokuma işine bağlı fason belgeleri: levent sevki · top kabulü · özet · iptaller.
// Bu dosya `test_dokuma_regime_gate §7` izinli istemci listesindedir (ekran
// `operations/weaving-orders`); ucu başka dosya yazmaz.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { FasonCancelPreview, FasonReceiptResult, FasonSummary } from "./types";

const BASE = "/api/subcontractor-weaving";

export interface FasonDispatchBody {
  weavingOrderId: string;
  warpBeamIds: string[];
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
}

export interface FasonReceiptBody {
  weavingOrderId: string;
  manifestNo: string | null;
  notes: string | null;
  clientToken: string;
  rolls: { initialQty: number; width: number | null; weightKg: number | null; qualityGrade: string | null; colorId: string | null }[];
}

export const fasonWeavingService = {
  summary: (weavingOrderId: string): Promise<ApiResponse<FasonSummary>> =>
    apiClient
      .get<ApiResponse<FasonSummary>>(`${BASE}/weaving-orders/${weavingOrderId}/summary`)
      .then((r) => r.data),
  dispatch: (body: FasonDispatchBody): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`${BASE}/dispatches`, body).then((r) => r.data),
  cancelDispatch: (id: string, reason: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`${BASE}/dispatches/${id}/cancel`, { reason }).then((r) => r.data),
  receive: (body: FasonReceiptBody): Promise<ApiResponse<FasonReceiptResult>> =>
    apiClient.post<ApiResponse<FasonReceiptResult>>(`${BASE}/receipts`, body).then((r) => r.data),
  receiptCancelPreview: (id: string): Promise<ApiResponse<FasonCancelPreview>> =>
    apiClient
      .get<ApiResponse<FasonCancelPreview>>(`${BASE}/receipts/${id}/cancel-preview`)
      .then((r) => r.data),
  cancelReceipt: (id: string, reason: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`${BASE}/receipts/${id}/cancel`, { reason }).then((r) => r.data),
  /** Levent dönüşü F1'in ucudur (sevk başlığına bakmaz); dokuma sevkinde de aynen çalışır. */
  returnBeam: (dispatchId: string, warpBeamId: string, body: { lengthM: number; clientToken: string }): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/subcontractor/dispatches/${dispatchId}/beams/${warpBeamId}/return`, body).then((r) => r.data),
};
