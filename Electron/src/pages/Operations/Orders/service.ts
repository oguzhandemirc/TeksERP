import apiClient from "@/services/apiClient";
import { createCrudService } from "@/services/crudService";
import { buildQueryString } from "@/lib/query-builder";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";
import type { ShipmentStatus } from "@/pages/Operations/Shipments/types";
import type { Order } from "./types";

const base = createCrudService<Order>("/api/orders");

export interface AliasSuggestResponse {
  itemAlias: string | null;
  colorAlias: string | null;
}

/** Spec (kumaş+renk+en) anlık müsaitlik — sipariş formu ipucu (metre). Rezervasyon DEĞİL. */
export interface SpecAvailability {
  freeWarehouse: number;
  inProduction: number;
  freeStock: number;
}

/** Sipariş detayında "hangi sevkiyata ne kadar sevk edildi" satırı. */
export interface OrderShipmentRow {
  /** DIRECT legacy toplu satırında boş (tıklanamaz). */
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  /** SHIPMENT = çuval sevkiyatı; DIRECT = fasondan doğrudan sevk. */
  kind: "SHIPMENT" | "DIRECT";
  date: string | null;
  qty: number;
  sackCount: number;
  branchName: string | null;
}

export interface OrderShipmentsResponse {
  /** DISPATCHED çuval + fason direkt — sipariş sevk toplamıyla mutabık. */
  dispatchedTotal: number;
  /** PLANNED çuval (bekleyen, henüz sevk edilmemiş). */
  plannedTotal: number;
  shipments: OrderShipmentRow[];
}

export type OrderCancelAction = "UNLINK_ONLY" | "CONVERT_TO_STOCK" | "CANCEL_WO";

export interface OrderCancelPreviewWO {
  id: string;
  workOrderNumber: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
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
   * (PLANNED/IN_PROGRESS/COMPLETED) bağlı satırları gizler;
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

  /**
   * Sipariş giriş formunda bir spec (kumaş+renk+en) için "Depoda / Üretimde / Ham"
   * anlık müsaitlik ipucu. Kaydedilmemiş satır (lineId'siz) için spec-bazlı çeker.
   * ANLIK FOTOĞRAF — rezervasyon değildir.
   */
  getSpecAvailability: (
    itemId: string,
    colorId?: string | null,
    width?: number | null,
  ): Promise<ApiResponse<SpecAvailability>> => {
    const params = new URLSearchParams({ itemId });
    if (colorId) params.set("colorId", colorId);
    if (width != null) params.set("width", String(width));
    return apiClient
      .get<ApiResponse<SpecAvailability>>(
        `/api/orders/spec-availability?${params.toString()}`,
      )
      .then((r) => r.data);
  },

  /**
   * Siparişin sevkiyat drill-down'ı — hangi sevkiyatlarla (çuval + fason direkt)
   * sevk edildi/bekliyor. Bilgilendirici (sevk muhasebesini değiştirmez).
   */
  getShipments: (orderId: string): Promise<ApiResponse<OrderShipmentsResponse>> =>
    apiClient
      .get<ApiResponse<OrderShipmentsResponse>>(`/api/orders/${orderId}/shipments`)
      .then((r) => r.data),
};
