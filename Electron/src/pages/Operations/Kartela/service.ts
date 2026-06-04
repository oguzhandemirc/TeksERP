import apiClient from "@/services/apiClient";
import type { ApiResponse, CursorPaginatedResponse, CursorParams } from "@/types/api";

// ---------------------------------------------------------------------------
// Types (backend kartela.service ile uyumlu)
// ---------------------------------------------------------------------------

export interface KartelaFirm {
  id: string;
  name: string;
  code: string | null;
}

export interface KartelaDispatchListItem {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: number;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  subcontractor: KartelaFirm;
  dispatchedBy: { id: string; fullName: string } | null;
  _count: { items: number; receipts: number };
}

export interface KartelaReceiptListItem {
  id: string;
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  notes: string | null;
  cancelledAt: string | null;
  subcontractor: KartelaFirm;
  receivedBy: { id: string; fullName: string } | null;
  _count: { items: number; swatches: number };
}

interface RollLite {
  id: string;
  barcode: string | null;
  currentQty: number;
  initialQty: number;
  width: number | null;
  weightKg: number | null;
  qualityGrade: string;
  item: { code: string; name: string };
  color: { code: string; name: string } | null;
}

export interface KartelaDispatchDetail {
  id: string;
  dispatchNo: string;
  dispatchedAt: string;
  totalQty: number;
  plateNumber: string | null;
  driverName: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  subcontractor: KartelaFirm;
  dispatchedBy: { id: string; username: string; fullName: string } | null;
  cancelledBy: { id: string; username: string; fullName: string } | null;
  items: Array<{
    id: string;
    dispatchedQty: number;
    dispatchedWeight: number | null;
    roll: RollLite;
  }>;
  receipts: Array<{ id: string; receiptNo: string; receivedAt: string }>;
}

export interface KartelaReceiptDetail {
  id: string;
  receiptNo: string;
  manifestNo: string | null;
  receivedAt: string;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  subcontractor: KartelaFirm;
  dispatch: { id: string; dispatchNo: string; dispatchedAt: string } | null;
  receivedBy: { id: string; username: string; fullName: string } | null;
  cancelledBy: { id: string; username: string; fullName: string } | null;
  items: Array<{
    id: string;
    kartelaCount: number;
    notes: string | null;
    consumedRoll: RollLite;
  }>;
  swatches: Array<{
    id: string;
    cardNumber: string;
    barcode: string;
    length: number | null;
    width: number | null;
    weightKg: number | null;
    parentRollId: string | null;
    item: { code: string; name: string };
    color: { code: string; name: string } | null;
  }>;
}

/**
 * useDataTable `CursorParams` → backend kartela list querystring.
 * Filtreler FilterBar'dan `filter[subcontractorId]` / `filter[status]` olarak
 * gelir → `params.filters.subcontractorId` / `.status`. Tarih DateRange'den
 * `dateFrom`/`dateTo` (ISO). Backend cursor mode + indeksli filtre uygular.
 */
function buildCursorQs(params: CursorParams): string {
  const sp = new URLSearchParams();
  sp.set("mode", "cursor");
  sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.withTotal) sp.set("withTotal", "true");
  if (params.search) sp.set("search", params.search);
  const f = params.filters ?? {};
  const sub = typeof f.subcontractorId === "string" ? f.subcontractorId : undefined;
  const status = typeof f.status === "string" ? f.status : undefined;
  if (sub) sp.set("subcontractorId", sub);
  if (status) sp.set("status", status);
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  return sp.toString();
}

export const kartelaService = {
  /** useDataTable uyumlu cursor pagination — sevkler. */
  listDispatchesCursor(params: CursorParams): Promise<CursorPaginatedResponse<KartelaDispatchListItem>> {
    return apiClient
      .get<CursorPaginatedResponse<KartelaDispatchListItem>>(
        `/api/kartela/dispatches?${buildCursorQs(params)}`,
      )
      .then((r) => r.data);
  },

  getDispatch(id: string): Promise<ApiResponse<KartelaDispatchDetail>> {
    return apiClient
      .get<ApiResponse<KartelaDispatchDetail>>(`/api/kartela/dispatches/${id}`)
      .then((r) => r.data);
  },

  /** useDataTable uyumlu cursor pagination — kabuller. */
  listReceiptsCursor(params: CursorParams): Promise<CursorPaginatedResponse<KartelaReceiptListItem>> {
    return apiClient
      .get<CursorPaginatedResponse<KartelaReceiptListItem>>(
        `/api/kartela/receipts?${buildCursorQs(params)}`,
      )
      .then((r) => r.data);
  },

  getReceipt(id: string): Promise<ApiResponse<KartelaReceiptDetail>> {
    return apiClient
      .get<ApiResponse<KartelaReceiptDetail>>(`/api/kartela/receipts/${id}`)
      .then((r) => r.data);
  },
};
