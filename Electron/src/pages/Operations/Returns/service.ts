import apiClient from "@/services/apiClient";
import { buildCursorQueryString } from "@/lib/query-builder";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";

// Backend return.service.listReturns ile uyumlu satır şekli.
export interface ReturnRow {
  id: string;
  qty: number;
  width: number | null;
  reasonText: string | null;
  note: string | null;
  createdAt: string;
  roll: { id: string; barcode: string | null } | null;
  item: { id: string; code: string; name: string } | null;
  color: { id: string; code: string; name: string } | null;
  customer: { id: string; code: string; name: string } | null;
  order: { id: string; orderNumber: string; status: string } | null;
  reason: { id: string; code: string; name: string; color: string | null } | null;
  qualityGrade: { id: string; code: string; name: string; color: string | null } | null;
  fromShipment: { id: string; shipmentNo: string } | null;
  receivedBy: { id: string; fullName: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { id: string; fullName: string } | null;
}

export interface ReturnsSummary {
  count: number;
  totalQty: number;
}

// İlk sayfada (withTotal) backend `summary` döndürür (adet + toplam metraj).
export type ReturnsCursorResponse = CursorPaginatedResponse<ReturnRow> & {
  summary?: ReturnsSummary;
};

export const returnsService = {
  listCursor: (params: CursorParams): Promise<ReturnsCursorResponse> =>
    apiClient
      .get<ReturnsCursorResponse>(`/api/returns${buildCursorQueryString(params)}`)
      .then((r) => r.data),

  /** İadeyi iptal et (geri al) — sebep zorunlu (min 3); top sevkiyatına geri döner. */
  cancel: (id: string, reason: string): Promise<ApiResponse<{ id: string; rollId: string }>> =>
    apiClient
      .post<ApiResponse<{ id: string; rollId: string }>>(`/api/returns/${id}/cancel`, { reason })
      .then((r) => r.data),

  /** Bir siparişe gelen (aktif) iade özeti — adet + metraj. Sipariş detayı satırı için. */
  summaryForOrder: (orderId: string): Promise<ReturnsSummary> =>
    apiClient
      .get<ReturnsCursorResponse>(`/api/returns?mode=cursor&withTotal=true&limit=1&orderId=${orderId}`)
      .then((r) => r.data.summary ?? { count: 0, totalQty: 0 }),
};
