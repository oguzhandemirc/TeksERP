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

export interface AliasStats {
  totalItemAliases: number;
  totalColorAliases: number;
  customersWithItemAlias: number;
  customersWithColorAlias: number;
  topCustomers: { customerId: string; customerName: string; itemAliases: number; colorAliases: number }[];
}

export const customerReportsApi = {
  orderProfile: async () => {
    const res = await apiClient.get<{ success: true; data: CustomerOrderProfileRow[] }>(
      "/api/reports/customer/order-profile",
    );
    return res.data;
  },
  aliasStats: async () => {
    const res = await apiClient.get<{ success: true; data: AliasStats }>(
      "/api/reports/customer/alias-stats",
    );
    return res.data;
  },
};
