import apiClient from "@/services/apiClient";
import type { ReportSecenekler, ReportSuzgec } from "../_services/types";

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
  // Süzgeç anahtarları yalnız VERİLİRSE gider; boş nesne bugünkü isteğin aynısıdır.
  orderProfile: async (params: Record<string, string> = {}) => {
    const res = await apiClient.get<{
      success: true;
      data: CustomerOrderProfileRow[];
      meta?: { secenekler?: ReportSecenekler };
      suzgec?: ReportSuzgec;
    }>("/api/reports/customer/order-profile", { params });
    return res.data;
  },
};
