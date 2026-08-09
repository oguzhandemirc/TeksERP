import apiClient from "@/services/apiClient";

export interface CustomerOrderProfileRow {
  customerId: string;
  customerName: string;
  customerCode: string;
  orderCount: number;
  lineCount: number;
  topItemName: string | null;
  topColorName: string | null;
  topWidth: number | null;
  lastOrderDate: string | null;
}

export const customerReportsApi = {
  orderProfile: async () => {
    const res = await apiClient.get<{ success: true; data: CustomerOrderProfileRow[] }>(
      "/api/reports/customer/order-profile",
    );
    return res.data;
  },
};
