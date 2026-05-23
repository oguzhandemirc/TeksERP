import apiClient from "@/services/apiClient";
import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams } from "../_services/types";

export interface OrderFulfillmentSummary {
  totalOrders: number;
  totalPlannedQty: number;
  totalShippedQty: number;
  byStatus: { status: string; count: number; plannedQty: number; shippedQty: number }[];
  worstFulfillment: {
    orderId: string;
    orderNumber: string;
    customerName: string;
    status: string;
    plannedQty: number;
    shippedQty: number;
    fulfillmentPct: number;
    deadline: string | null;
  }[];
}

export interface LateDeliveryRow {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  deadline: string;
  plannedQty: number;
  shippedQty: number;
  remainingQty: number;
  daysLate: number;
}

export interface CustomerShipmentRow {
  customerId: string;
  customerName: string;
  customerCode: string;
  shipmentCount: number;
  totalQty: number;
  totalWeightKg: number | null;
  rollCount: number;
}

export const salesReportsApi = {
  orderFulfillment: (params: ReportDateParams) =>
    reportsClient.get<OrderFulfillmentSummary>("sales/order-fulfillment", params),
  customerShipments: (params: ReportDateParams) =>
    reportsClient.get<CustomerShipmentRow[]>("sales/customer-shipments", params),
  lateDeliveries: async () => {
    const res = await apiClient.get<{ success: true; data: LateDeliveryRow[] }>(
      "/api/reports/sales/late-delivery",
    );
    return res.data;
  },
};
