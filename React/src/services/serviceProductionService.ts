import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { StationKind } from "@/types/enums";

export interface ServiceIntakeRollInput {
  initialQty: number;
  weightKg?: number | null;
  qualityGrade?: string | null;
  width?: number | null;
  customerDescription?: string | null;
}

export interface ServiceIntakeRequest {
  customerId: string;
  itemId: string;
  variantId?: string | null;
  servicePricePerMeter: number;
  routeStationKinds: StationKind[];
  batchNumber?: string | null;
  notes?: string | null;
  rolls: ServiceIntakeRollInput[];
}

export interface ServiceIntakeResponse {
  workOrderId: string;
  batchNumber: string;
  rollIds: string[];
  barcodes: string[];
}

export const serviceProductionService = {
  createIntake(
    data: ServiceIntakeRequest,
  ): Promise<ApiResponse<ServiceIntakeResponse>> {
    return apiClient
      .post<ApiResponse<ServiceIntakeResponse>>(
        "/api/service-production/intake",
        data,
      )
      .then((r) => r.data);
  },
};
