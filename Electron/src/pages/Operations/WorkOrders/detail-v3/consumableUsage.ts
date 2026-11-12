// İE sarfiyatı (`GET /api/work-orders/:id/consumables`) — sunucu toplar ve maliyeti türetir; istemci yalnız biçimler.
// Maliyet alanları yalnız `cost:read` iken yanıtta bulunur (OPT-IN); izinsizde hiç gelmez.
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export interface ConsumableUsageRow {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  qty: string;
  kursunKg: string | null;
  costTry?: string | null;
  unitCostTry?: string | null;
}

export interface ConsumableUsage {
  enabled: boolean;
  rows: ConsumableUsageRow[];
  totalCostTry?: string | null;
  customer?: { amountTry: string | null; diffTry: string | null } | null;
}

export const CONSUMABLE_USAGE_KEY = "work-order-consumables";

export async function getWorkOrderConsumableUsage(workOrderId: string): Promise<ConsumableUsage> {
  return (await apiClient.get<ApiResponse<ConsumableUsage>>(`/api/work-orders/${workOrderId}/consumables`)).data.data;
}
