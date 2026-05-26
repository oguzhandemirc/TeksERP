import apiClient from "@/services/apiClient";
import { reportsClient } from "../_services/reportsClient";
import type { ReportDateParams } from "../_services/types";

export interface RollAgingSummary {
  buckets: { bucket: string; count: number; qty: number }[];
  totalRolls: number;
  totalQty: number;
  oldestDays: number;
}

export interface StockDistribution {
  totalRolls: number;
  totalQty: number;
  byItemColor: { itemName: string; colorName: string; rollCount: number; totalQty: number }[];
  byWidth: { widthBucket: string; rollCount: number; totalQty: number }[];
}

export interface DailyMovementRow {
  day: string;
  stationName: string;
  movementCount: number;
}

async function getSnapshot<T>(path: string) {
  const res = await apiClient.get<{ success: true; data: T }>(`/api/reports/${path}`);
  return res.data;
}

export const inventoryReportsApi = {
  rollAging: () => getSnapshot<RollAgingSummary>("inventory/roll-aging"),
  stockDistribution: () => getSnapshot<StockDistribution>("inventory/stock-distribution"),
  dailyMovements: (p: ReportDateParams) =>
    reportsClient.get<DailyMovementRow[]>("inventory/movements", p),
};
