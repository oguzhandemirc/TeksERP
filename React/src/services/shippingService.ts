import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Shipment, ReadyOrderView } from "@/types/models";
import type { ShipmentStatus, RollStatus } from "@/types/enums";

export interface ReadyFasonRollView {
  rollId: string;
  barcode: string;
  itemCode: string;
  itemName: string;
  variantCode: string | null;
  variantName: string | null;
  currentQty: number;
  weightKg: number | null;
  width: number | null;
  qualityGrade: string;
  status: RollStatus;
  packagingDate: string | null;
}

export interface ReadyFasonGroup {
  customerId: string;
  customerName: string;
  rolls: ReadyFasonRollView[];
}

export interface PreparePackageRequest {
  rollIds: string[];
  packageId: string;
  grossWeightKg: number;
}

export interface CreateShipmentRequest {
  customerId: string;
  driverName?: string;
  plateNumber?: string;
  carrier?: string;
}

export interface ShipmentListFilters {
  status?: ShipmentStatus;
  customerId?: string;
}

export interface ShipmentPrintSnapshot {
  version: 1;
  snapshotAt: string;
  frozen: boolean;
  shipment: {
    id: string;
    shipmentNumber: string;
    status: ShipmentStatus;
    shippedAt: string | null;
    createdAt: string;
    driverName: string | null;
    plateNumber: string | null;
    carrier: string | null;
  };
  customer: {
    id: string;
    code: string | null;
    name: string;
  };
  items: Array<{
    id: string;
    sequence: number;
    rollId: string;
    rollBarcode: string;
    itemCode: string;
    itemName: string;
    variantCode: string | null;
    variantName: string | null;
    customerLabel: string | null;
    customerCode: string | null;
    customerLabelSource: "ALIAS" | "ROLL_DESCRIPTION" | null;
    orderNumber: string | null;
    workOrderBatchNumber: string | null;
    workOrderType: string | null;
    shippedQty: number;
    shippedWeight: number | null;
  }>;
  totals: {
    itemCount: number;
    totalQty: number;
    totalWeight: number;
  };
}

export const shippingService = {
  getReadyOrders(): Promise<ApiResponse<ReadyOrderView[]>> {
    return apiClient
      .get<ApiResponse<ReadyOrderView[]>>("/api/shipping/ready-orders")
      .then((r) => r.data);
  },

  getReadyFason(): Promise<ApiResponse<ReadyFasonGroup[]>> {
    return apiClient
      .get<ApiResponse<ReadyFasonGroup[]>>("/api/shipping/ready-fason")
      .then((r) => r.data);
  },

  list(filters?: ShipmentListFilters): Promise<ApiResponse<Shipment[]>> {
    return apiClient
      .get<ApiResponse<Shipment[]>>("/api/shipping/shipments", {
        params: filters,
      })
      .then((r) => r.data);
  },

  getById(shipmentId: string): Promise<ApiResponse<Shipment>> {
    return apiClient
      .get<ApiResponse<Shipment>>(`/api/shipping/shipments/${shipmentId}`)
      .then((r) => r.data);
  },

  getPrintSnapshot(shipmentId: string): Promise<ApiResponse<ShipmentPrintSnapshot>> {
    return apiClient
      .get<ApiResponse<ShipmentPrintSnapshot>>(
        `/api/shipping/shipments/${shipmentId}/print`,
      )
      .then((r) => r.data);
  },

  preparePackage(
    data: PreparePackageRequest,
  ): Promise<ApiResponse<{ packaged: number }>> {
    return apiClient
      .post<ApiResponse<{ packaged: number }>>(
        "/api/shipping/prepare-package",
        data,
      )
      .then((r) => r.data);
  },

  createShipment(data: CreateShipmentRequest): Promise<ApiResponse<Shipment>> {
    return apiClient
      .post<ApiResponse<Shipment>>("/api/shipping/shipments", data)
      .then((r) => r.data);
  },

  addItems(
    shipmentId: string,
    rollIds: string[],
  ): Promise<
    ApiResponse<{
      added: number;
      reassigned: number;
      notFound: number;
      ownerMismatch: number;
      wrongStatus: number;
      alreadyInShipment: number;
    }>
  > {
    return apiClient
      .patch<
        ApiResponse<{
          added: number;
          reassigned: number;
          notFound: number;
          ownerMismatch: number;
          wrongStatus: number;
          alreadyInShipment: number;
        }>
      >(`/api/shipping/shipments/${shipmentId}/add-items`, { rollIds })
      .then((r) => r.data);
  },

  finalize(
    shipmentId: string,
  ): Promise<
    ApiResponse<{
      shipment: Shipment;
      rollupdated: number;
      ordersCompleted: string[];
      ordersPartial: string[];
      workOrdersCompleted: string[];
    }>
  > {
    return apiClient
      .post<
        ApiResponse<{
          shipment: Shipment;
          rollupdated: number;
          ordersCompleted: string[];
          ordersPartial: string[];
          workOrdersCompleted: string[];
        }>
      >(`/api/shipping/shipments/${shipmentId}/finalize`)
      .then((r) => r.data);
  },
};
