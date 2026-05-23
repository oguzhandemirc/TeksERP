import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export type LabelNameSource = "OVERRIDE" | "MASTER" | "DEFAULT";

export interface RollLabelPayload {
  rollId: string;
  barcode: string | null;
  status: string;
  qualityGrade: string;
  widthCm: number | null;
  lengthMeters: number;
  weightKg: number | null;
  packagingDate: string | null;

  itemCode: string;
  itemName: string;
  itemNameDefault: string;
  itemNameSource: LabelNameSource;

  colorCode: string | null;
  colorName: string | null;
  colorNameDefault: string | null;
  colorNameSource: LabelNameSource | null;

  customerName: string | null;
  customerId: string | null;
  orderNumber: string | null;
  orderLineId: string | null;

  ownerCustomerName: string | null;
  batchNumber: string | null;
  printedAt: string | null;
}

export interface OrderLineOverridePayload {
  customerItemName?: string | null;
  customerColorName?: string | null;
}

export const labelService = {
  getRollLabel: (rollId: string): Promise<ApiResponse<RollLabelPayload>> =>
    apiClient
      .get<ApiResponse<RollLabelPayload>>(`/api/labels/rolls/${rollId}`)
      .then((r) => r.data),

  updateOrderLineOverride: (
    orderLineId: string,
    body: OrderLineOverridePayload,
  ): Promise<ApiResponse<{ orderLineId: string }>> =>
    apiClient
      .patch<ApiResponse<{ orderLineId: string }>>(
        `/api/labels/order-lines/${orderLineId}`,
        body,
      )
      .then((r) => r.data),

  printRollLabel: (rollId: string): Promise<ApiResponse<{ rollId: string }>> =>
    apiClient
      .post<ApiResponse<{ rollId: string }>>(`/api/labels/rolls/${rollId}/print`)
      .then((r) => r.data),
};
