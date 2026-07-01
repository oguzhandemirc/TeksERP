import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { RelabelContext, RelabelSpecPayload } from "./types";

export const relabelService = {
  /** Barkod → zengin relabel bağlamı (spec + guard + son baskı + müşteri adayları). */
  getContext: (barcode: string): Promise<ApiResponse<RelabelContext>> =>
    apiClient
      .get<ApiResponse<RelabelContext>>(
        `/api/rolls/barcode/${encodeURIComponent(barcode)}/relabel-context`,
      )
      .then((r) => r.data),

  /** Spec düzelt (renk/kalite/en/özellik) — mevcut applyManualProperties ucu. */
  applySpec: (rollId: string, body: RelabelSpecPayload): Promise<ApiResponse<unknown>> =>
    apiClient
      .patch<ApiResponse<unknown>>(`/api/rolls/${rollId}/label`, body)
      .then((r) => r.data),

  /** Kartelalık (kartela için) işaretini set/kaldır — mevcut /kartela/rolls/:id/mark ucu. */
  setMarkedForKartela: (rollId: string, value: boolean): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`/api/kartela/rolls/${rollId}/mark`, { value })
      .then((r) => r.data),
};
