// =============================================================================
// FASON DOKUMA (G2p) — servis: `/api/subcontractor-weaving` (requireDokumaEnabled)
// =============================================================================
// Dokuma işine bağlı fason belgeleri: levent sevki · top kabulü · özet · iptaller.
// Bu dosya `test_dokuma_regime_gate §7` izinli istemci listesindedir (ekran
// `operations/weaving-orders`); ucu başka dosya yazmaz.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { FasonCancelPreview, FasonReceiptResult, FasonSummary, FasonYarnBalanceRow } from "./types";

const BASE = "/api/subcontractor-weaving";

/** G1: iplik satırı — backend `yarnLineSchema` ile birebir (`.strict()`; lot nullish; kg sayı). */
export interface FasonYarnLine {
  itemId: string;
  warehouseId: string;
  lotId: string | null;
  qtyKg: number;
}
export interface FasonDispatchBody {
  weavingOrderId: string;
  warpBeamIds: string[];
  /** G1: levent-yalnız, iplik-yalnız ya da ikisi; iplik modülü kapalıyken GÖNDERİLMEZ (alan yok). */
  yarnLines?: FasonYarnLine[];
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
}
export interface FasonYarnReturnBody {
  qtyKg: number;
  reasonCode: string;
  warehouseId?: string | null;
  lotId?: string | null;
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
  /** G1 iplik dönüşü / stornosu ve fasoncu bakiyesi — F1 gibi `/api/subcontractor` uçları (iplik kapılı). */
  returnYarn: (dispatchId: string, dispatchItemId: string, body: FasonYarnReturnBody): Promise<ApiResponse<{ remainingKg: number }>> =>
    apiClient.post<ApiResponse<{ remainingKg: number }>>(`/api/subcontractor/dispatches/${dispatchId}/yarn-items/${dispatchItemId}/return`, body).then((r) => r.data),
  cancelYarnReturn: (dispatchId: string, dispatchItemId: string, body: { movementId: string; reason: string }): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`/api/subcontractor/dispatches/${dispatchId}/yarn-items/${dispatchItemId}/return-cancel`, body).then((r) => r.data),
  yarnBalance: (subcontractorId: string): Promise<ApiResponse<FasonYarnBalanceRow[]>> =>
    apiClient.get<ApiResponse<FasonYarnBalanceRow[]>>(`/api/subcontractor/${subcontractorId}/yarn-balance`).then((r) => r.data),
};
