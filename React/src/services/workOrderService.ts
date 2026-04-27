import apiClient from "./apiClient";
import type { ApiResponse, PaginatedResponse, QueryParams } from "@/types/api";
import type { WorkOrder, Manifest, Shipment } from "@/types/models";
import { buildQueryString } from "@/lib/query-builder";

export interface OrderLineAllocation {
  orderLineId:  string;
  allocatedQty?: number;
}

export interface CreateWorkOrderRequest {
  batchNumber?:       string;
  type?:              string;
  width?:             number;
  targetQuantity?:    number;
  recipeNo?:          string;
  plannedStartDate?:  string;
  plannedEndDate?:    string;
  parameters?:        Record<string, unknown>;
  routeTemplateId?:   string | null;
  dyehouseCompanyId?: string | null;
  steps?:             { stationId: string; notes?: string }[];
  orderLineIds?:      string[];
  orderLineAllocations?: OrderLineAllocation[];
  // Hedef renk + özellikler — fason adımlarında uygulanır
  targetColorId?:        string;
  targetColorStepIndex?: number;
  targetProperties?: {
    propertyId:        string;
    plannedStepIndex?: number;
    notes?:            string;
  }[];
}

export interface AttachRollsResponse {
  attached: number;
  errors: string[];
}

export interface DetachRollsResponse {
  detached: number;
}


export const workOrderService = {
  getAll(params: QueryParams): Promise<PaginatedResponse<WorkOrder>> {
    const qs = buildQueryString(params);
    return apiClient
      .get<PaginatedResponse<WorkOrder>>(`/api/work-orders${qs}`)
      .then((r) => r.data);
  },

  getById(id: string): Promise<ApiResponse<WorkOrder>> {
    return apiClient
      .get<ApiResponse<WorkOrder>>(`/api/work-orders/${id}`)
      .then((r) => r.data);
  },

  create(data: CreateWorkOrderRequest): Promise<ApiResponse<WorkOrder>> {
    return apiClient
      .post<ApiResponse<WorkOrder>>("/api/work-orders", data)
      .then((r) => r.data);
  },

  attachRolls(
    id: string,
    barcodes: string[],
  ): Promise<ApiResponse<AttachRollsResponse>> {
    return apiClient
      .patch<ApiResponse<AttachRollsResponse>>(
        `/api/work-orders/${id}/attach-rolls`,
        { barcodes },
      )
      .then((r) => r.data);
  },

  detachRolls(
    id: string,
    rollIds: string[],
  ): Promise<ApiResponse<DetachRollsResponse>> {
    return apiClient
      .patch<ApiResponse<DetachRollsResponse>>(
        `/api/work-orders/${id}/detach-rolls`,
        { rollIds },
      )
      .then((r) => r.data);
  },

  lockWorkOrder(id: string): Promise<ApiResponse<WorkOrder>> {
    return apiClient
      .patch<ApiResponse<WorkOrder>>(`/api/work-orders/${id}/lock`)
      .then((r) => r.data);
  },

  getAttachedRolls(id: string): Promise<ApiResponse<any[]>> {
    return apiClient
      .get<ApiResponse<any[]>>(`/api/work-orders/${id}/rolls`)
      .then((r) => r.data);
  },


  softDelete(id: string): Promise<ApiResponse<WorkOrder>> {
    return apiClient
      .delete<ApiResponse<WorkOrder>>(`/api/work-orders/${id}`)
      .then((r) => r.data);
  },

  hardDelete(id: string): Promise<ApiResponse<WorkOrder>> {
    return apiClient
      .delete<ApiResponse<WorkOrder>>(`/api/work-orders/${id}/permanent`)
      .then((r) => r.data);
  },

  getTravelCard(
    id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return apiClient
      .get<ApiResponse<Record<string, unknown>>>(
        `/api/work-orders/${id}/travel-card`,
      )
      .then((r) => r.data);
  },

  getManifest(
    id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return apiClient
      .get<ApiResponse<Record<string, unknown>>>(
        `/api/work-orders/${id}/manifest`,
      )
      .then((r) => r.data);
  },

  createManifest(
    id: string,
    notes?: string,
  ): Promise<ApiResponse<Manifest>> {
    return apiClient
      .post<ApiResponse<Manifest>>(
        `/api/work-orders/${id}/manifest`,
        { notes },
      )
      .then((r) => r.data);
  },

  listManifests(id: string): Promise<ApiResponse<Manifest[]>> {
    return apiClient
      .get<ApiResponse<Manifest[]>>(
        `/api/work-orders/${id}/manifests`,
      )
      .then((r) => r.data);
  },

  listShipments(id: string): Promise<ApiResponse<Shipment[]>> {
    return apiClient
      .get<ApiResponse<Shipment[]>>(
        `/api/work-orders/${id}/shipments`,
      )
      .then((r) => r.data);
  },

  getAvailableForAttach(): Promise<ApiResponse<WorkOrder[]>> {
    return apiClient
      .get<ApiResponse<WorkOrder[]>>("/api/work-orders/available-for-attach")
      .then((r) => r.data);
  },
};
