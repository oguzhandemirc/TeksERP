import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import { buildQueryString } from "@/lib/query-builder";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";
import type { Order } from "./types";

const base = createCrudService<Order>("/api/orders");

export interface AliasSuggestResponse {
  itemAlias: string | null;
  colorAlias: string | null;
}

export type OrderCancelAction = "UNLINK_ONLY" | "CONVERT_TO_STOCK" | "CANCEL_WO";

export interface OrderCancelPreviewWO {
  id: string;
  batchNumber: string;
  status: "PLANNED" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED";
  /** WO'nun hedef üretim metrajı (link-only: per-sipariş tahsis yok). null olabilir. */
  targetQuantity: number | null;
  isSoleOrder: boolean;
  otherOrdersCount: number;
  otherOrderNumbers: string[];
  producedRollCount: number;
  allowedActions: OrderCancelAction[];
  defaultAction: OrderCancelAction;
}

export interface OrderCancelPreview {
  orderId: string;
  orderNumber: string;
  affectedWorkOrders: OrderCancelPreviewWO[];
  /** O2 fix: aktif sevkiyat bağları — varken backend iptali 409 ile bloklar;
   *  UI onay butonunu kapatıp engelleri somut listeler. */
  activeShipments: Array<{ shipmentNo: string; status: string }>;
  canCancel: boolean;
}

export const orderService = {
  ...base,
  manualClose: (id: string, reason: string): Promise<ApiResponse<Order>> =>
    apiClient
      .post<ApiResponse<Order>>(`/api/orders/${id}/manual-close`, { reason })
      .then((r) => r.data),

  /**
   * İş emri picker'ı için müsait kalemleri çeker. Backend aktif WO'ya
   * (PLANNED/IN_PROGRESS/PAUSED/COMPLETED) bağlı satırları gizler;
   * `excludeWorkOrderId` verilirse o WO'nun kendi bağları "müsait" sayılır
   * (edit modu).
   */
  getAvailableForWorkOrder: (
    params: QueryParams,
    excludeWorkOrderId?: string,
  ): Promise<PaginatedResponse<Order>> => {
    const qs = buildQueryString(params);
    const suffix = excludeWorkOrderId
      ? `${qs ? `${qs}&` : "?"}excludeWorkOrderId=${encodeURIComponent(excludeWorkOrderId)}`
      : qs;
    return apiClient
      .get<PaginatedResponse<Order>>(`/api/orders/wo-picker${suffix}`)
      .then((r) => r.data);
  },

  /**
   * Sipariş iptal preview — etkilenecek WO listesi. Operatöre confirm dialog'da
   * gösterilir. Her WO için izinli aksiyon set'i + default aksiyon döner.
   */
  getCancelPreview: (id: string): Promise<ApiResponse<OrderCancelPreview>> =>
    apiClient
      .get<ApiResponse<OrderCancelPreview>>(`/api/orders/${id}/cancel-preview`)
      .then((r) => r.data),

  /**
   * Sipariş iptal — operatör seçimleriyle. `workOrderActions` boşsa backend
   * default davranışı uygular (preview'daki defaultAction'lar).
   */
  cancelWithActions: (
    id: string,
    workOrderActions: Array<{ workOrderId: string; action: OrderCancelAction }>,
  ): Promise<ApiResponse<Order>> =>
    apiClient
      .post<ApiResponse<Order>>(`/api/orders/${id}/cancel`, { workOrderActions })
      .then((r) => r.data),

  suggestAliases: (
    customerId: string,
    itemId: string,
    colorId?: string | null,
  ): Promise<ApiResponse<AliasSuggestResponse>> => {
    const params = new URLSearchParams({ itemId });
    if (colorId) params.set("colorId", colorId);
    return apiClient
      .get<ApiResponse<AliasSuggestResponse>>(
        `/api/customers/${customerId}/aliases/suggest?${params.toString()}`,
      )
      .then((r) => r.data);
  },
};
