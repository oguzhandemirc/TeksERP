import apiClient from "@/services/apiClient";
import { orderService } from "@/pages/Operations/Orders/service";
import { workOrderService } from "@/pages/Operations/WorkOrders/service";
import { rollService } from "@/pages/Operations/Rolls/service";
import type { ApiResponse, QueryParams } from "@/types/api";
import type { Order } from "@/pages/Operations/Orders/types";
import type { WorkOrder } from "@/pages/Operations/WorkOrders/types";

const countParams = (filters: Record<string, string>): QueryParams => ({
  page: 1,
  pageSize: 1,
  sortBy: "createdAt",
  sortOrder: "desc",
  filters,
});

export async function fetchOpenOrderCount(): Promise<number> {
  const res = await orderService.getAll(
    countParams({ status: "PENDING,APPROVED,PARTIAL_SHIPPED" }),
  );
  return res.pagination.total;
}

export async function fetchOpenWorkOrderCount(): Promise<number> {
  const res = await workOrderService.getAll(
    countParams({ status: "PLANNED,IN_PROGRESS" }),
  );
  return res.pagination.total;
}

export async function fetchRollCount(status: string): Promise<number> {
  const res = await rollService.getAll(countParams({ status }));
  return res.pagination.total;
}

/**
 * "Üretimde" sayısı — Roll listesi sekmesindeki PRODUCTION sekmesiyle aynı:
 * IN_PRODUCTION + AT_SUBCONTRACTOR + Kurşun/Tambur bekleyen açık kumaş hepsi
 * dahil. Sadece `status=IN_PRODUCTION` saymak fasondaki rulonları kaybeder.
 */
export async function fetchProductionActiveRollCount(): Promise<number> {
  const res = await rollService.getAll(
    countParams({ rollScope: "PRODUCTION_ACTIVE", status: "ALL" }),
  );
  return res.pagination.total;
}

export async function fetchUpcomingOrders(): Promise<Order[]> {
  // deadline'ı null olanları dışla — dateField+dateFrom IS NOT NULL etkisi yapar.
  const res = await orderService.getAll({
    page: 1,
    pageSize: 8,
    sortBy: "deadline",
    sortOrder: "asc",
    filters: { status: "APPROVED,PARTIAL_SHIPPED" },
    dateField: "deadline",
    dateFrom: "2000-01-01T00:00:00.000Z",
  });
  return res.data;
}

export async function fetchOverdueWorkOrders(): Promise<WorkOrder[]> {
  // plannedEndDate < now AND status NOT IN (COMPLETED, CANCELLED).
  // dateTo=now ile null + future ekarte edilir, en eski geciken üstte.
  const res = await workOrderService.getAll({
    page: 1,
    pageSize: 8,
    sortBy: "plannedEndDate",
    sortOrder: "asc",
    filters: { status: "PLANNED,IN_PROGRESS" },
    dateField: "plannedEndDate",
    dateTo: new Date().toISOString(),
  });
  return res.data;
}

export async function fetchUpcomingWorkOrders(): Promise<WorkOrder[]> {
  // Önümüzdeki 7 günde başlaması planlanan PLANNED iş emirleri.
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  const res = await workOrderService.getAll({
    page: 1,
    pageSize: 8,
    sortBy: "plannedStartDate",
    sortOrder: "asc",
    filters: { status: "PLANNED" },
    dateField: "plannedStartDate",
    dateFrom: now.toISOString(),
    dateTo: in7.toISOString(),
  });
  return res.data;
}

export interface StationLiveState {
  id: string;
  code: string;
  name: string;
  kind: string;
  type: string;
  queueCount: number;
  activeCount: number;
  todayCompletedCount: number;
  /** EXTERNAL istasyonlarda bugün sevk edilen parça sayısı. INTERNAL'de 0. */
  todayDispatchedCount: number;
}

export async function fetchStationLiveState(): Promise<StationLiveState[]> {
  const res = await apiClient.get<ApiResponse<StationLiveState[]>>(
    "/api/dashboard/stations/live-state",
  );
  return res.data.data;
}
