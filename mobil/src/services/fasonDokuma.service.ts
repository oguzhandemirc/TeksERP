// =============================================================================
// FASON DOKUMA KABUL — MOBİL SERVİS (G2t, 2026-09-14)
// =============================================================================
// Bağlam TEK uç (`/subcontractor-weaving/tablet-context`, opt-in allowlist);
// top kabulü G2'nin `POST /receipts` ucu; levent dönüşü F1'in ucu
// (`/subcontractor/dispatches/:id/beams/:beamId/return`). Kuyruk YOK —
// gitmezse anında söyler; `clientToken` mantıksal deneme başına (`receiptAttempt`).
// Ekran izni `mobile:fason-kabul` üç uçta da kabul edilir.
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export interface FasonTabletBeam {
  id: string;
  beamNo: string;
  sentM: number;
}
export interface FasonTabletDispatch {
  dispatchId: string;
  dispatchNo: string;
  dispatchedAt: string;
  beams: FasonTabletBeam[];
}
export interface FasonTabletOrder {
  id: string;
  weavingOrderNumber: string;
  status: string;
  item: { name: string };
  color: { name: string } | null;
  subcontractor: { name: string } | null;
  openDispatches: FasonTabletDispatch[];
}
export interface FasonTabletContext {
  weavingOrders: FasonTabletOrder[];
}

export interface FasonReceiptRollPayload {
  initialQty: number;
  width: number | null;
  weightKg: number | null;
  qualityGrade: string | null;
  colorId: string | null;
}
export interface FasonReceiptRequest {
  weavingOrderId: string;
  manifestNo: string | null;
  notes: string | null;
  clientToken: string;
  rolls: FasonReceiptRollPayload[];
}
export interface FasonReceiptResult {
  receipt: { id: string; receiptNo: string };
  rolls: { id: string; barcode: string | null; initialQty: number }[];
  failed: { index: number; message: string }[];
}

export const fasonDokumaService = {
  tabletContext: async (): Promise<FasonTabletContext> => {
    const res = await apiClient.get<ApiResponse<FasonTabletContext>>('/subcontractor-weaving/tablet-context');
    return res.data.data;
  },
  receive: async (body: FasonReceiptRequest): Promise<ApiResponse<FasonReceiptResult>> =>
    (await apiClient.post<ApiResponse<FasonReceiptResult>>('/subcontractor-weaving/receipts', body)).data,
  returnBeam: async (dispatchId: string, warpBeamId: string, body: { lengthM: number; clientToken: string }): Promise<ApiResponse<unknown>> =>
    (await apiClient.post<ApiResponse<unknown>>(`/subcontractor/dispatches/${dispatchId}/beams/${warpBeamId}/return`, body)).data,
};
