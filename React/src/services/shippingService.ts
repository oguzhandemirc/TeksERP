import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { Shipment, ReadyOrderView } from "@/types/models";

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

export const shippingService = {
  getReadyOrders(): Promise<ApiResponse<ReadyOrderView[]>> {
    return apiClient
      .get<ApiResponse<ReadyOrderView[]>>("/api/shipping/ready-orders")
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
  ): Promise<ApiResponse<{ added: number; reassigned: number }>> {
    return apiClient
      .patch<ApiResponse<{ added: number; reassigned: number }>>(
        `/api/shipping/shipments/${shipmentId}/add-items`,
        { rollIds },
      )
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
    }>
  > {
    return apiClient
      .post<
        ApiResponse<{
          shipment: Shipment;
          rollupdated: number;
          ordersCompleted: string[];
          ordersPartial: string[];
        }>
      >(`/api/shipping/shipments/${shipmentId}/finalize`)
      .then((r) => r.data);
  },
};
