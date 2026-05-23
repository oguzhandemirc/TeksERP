import apiClient from "@/services/apiClient";
import type {
  ApiResponse,
  CursorPaginatedResponse,
  CursorParams,
} from "@/types/api";
import type { Shipment } from "./types";

// Backend `/api/shipping/shipments` standart QueryParams kullanmaz —
// `status`/`customerId`/`q` direkt parametre. Cursor pagination destekler;
// adapter ile DataTable sözleşmesine çeviriyoruz.
export const shipmentService = {
  listCursor: (params: CursorParams): Promise<CursorPaginatedResponse<Shipment>> => {
    const sp = new URLSearchParams();
    sp.set("mode", "cursor");
    sp.set("limit", String(params.limit));
    if (params.cursor) sp.set("cursor", params.cursor);
    if (params.search) sp.set("q", params.search);

    const status = params.filters.status;
    if (typeof status === "string") sp.set("status", status);
    const customerId = params.filters.customerId;
    if (typeof customerId === "string") sp.set("customerId", customerId);

    if (params.dateField) sp.set("dateField", params.dateField);
    if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
    if (params.dateTo) sp.set("dateTo", params.dateTo);
    if (params.withTotal) sp.set("withTotal", "true");
    if (params.sortBy && params.sortBy !== "createdAt") sp.set("sortBy", params.sortBy);
    if (params.sortOrder && params.sortOrder !== "desc") sp.set("sortOrder", params.sortOrder);

    return apiClient
      .get<CursorPaginatedResponse<Shipment>>(`/api/shipping/shipments?${sp.toString()}`)
      .then((r) => r.data);
  },

  getById: (id: string): Promise<ApiResponse<Shipment>> =>
    apiClient.get<ApiResponse<Shipment>>(`/api/shipping/shipments/${id}`).then((r) => r.data),

  create: (data: {
    customerId: string;
    branchId?: string | null;
    driverName?: string;
    plateNumber?: string;
    carrier?: string;
    plannedDate?: string | null;
  }): Promise<ApiResponse<Shipment>> =>
    apiClient
      .post<ApiResponse<Shipment>>("/api/shipping/shipments", data)
      .then((r) => r.data),

  addItems: (
    id: string,
    rollIds: string[]
  ): Promise<
    ApiResponse<{
      added: number;
      reassigned: number;
      notFound: number;
      ownerMismatch: number;
      wrongStatus: number;
      alreadyInShipment: number;
      swatchesSkipped: number;
    }>
  > =>
    apiClient
      .patch<
        ApiResponse<{
          added: number;
          reassigned: number;
          notFound: number;
          ownerMismatch: number;
          wrongStatus: number;
          alreadyInShipment: number;
          swatchesSkipped: number;
        }>
      >(`/api/shipping/shipments/${id}/add-items`, { rollIds })
      .then((r) => r.data),

  finalize: (id: string): Promise<ApiResponse<Shipment>> =>
    apiClient
      .post<ApiResponse<Shipment>>(`/api/shipping/shipments/${id}/finalize`)
      .then((r) => r.data),

  readyForCustomer: (customerId: string): Promise<ApiResponse<ReadyOrder[]>> => {
    const sp = new URLSearchParams({ customerId, mode: "offset", limit: "100" });
    return apiClient
      .get<ApiResponse<ReadyOrder[]>>(`/api/shipping/ready-orders?${sp.toString()}`)
      .then((r) => r.data);
  },

  readyOrders: (search?: string): Promise<ApiResponse<ReadyOrder[]>> => {
    const sp = new URLSearchParams({ mode: "offset", limit: "100" });
    if (search) sp.set("q", search);
    return apiClient
      .get<ApiResponse<ReadyOrder[]>>(`/api/shipping/ready-orders?${sp.toString()}`)
      .then((r) => r.data);
  },

  readyFason: (): Promise<ApiResponse<ReadyFasonGroup[]>> =>
    apiClient
      .get<ApiResponse<ReadyFasonGroup[]>>("/api/shipping/ready-fason")
      .then((r) => r.data),
};

export interface ReadyOrderRoll {
  allocationId: string;
  rollId: string;
  barcode: string | null;
  allocatedQty: number;
  rollStatus: string;
  packageId: string | null;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
}

export interface ReadyOrderLine {
  lineId: string;
  itemCode: string;
  itemName: string;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  width: number | null;
  unitPrice: string | null;
  requestedQty: number;
  allocatedRolls: ReadyOrderRoll[];
}

export interface ReadyOrder {
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  branchId: string | null;
  branch: { id: string; name: string; city: string | null; district: string | null } | null;
  status: string;
  orderDate: string;
  deadline: string | null;
  currency: string;
  totalAmount: string | null;
  lines: ReadyOrderLine[];
}

export interface ReadyFasonRoll {
  rollId: string;
  barcode: string | null;
  itemCode: string;
  itemName: string;
  colorCode: string | null;
  colorName: string | null;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: string;
  packagingDate: string | null;
}

export interface ReadyFasonGroup {
  customerId: string;
  customerName: string;
  rolls: ReadyFasonRoll[];
}
