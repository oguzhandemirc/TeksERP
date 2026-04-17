import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import KPICard from "@/components/charts/KPICard";
import BarChartCard from "@/components/charts/BarChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import { orderService } from "@/services/orderService";
import { rollService } from "@/services/rollService";
import { workOrderService } from "@/services/workOrderService";
import type { Order, Roll, WorkOrder } from "@/types/models";

function computeOrderStats(orders: Order[]) {
  const statusCounts: Record<string, number> = {};
  let totalRevenue = 0;
  const monthlyMap: Record<string, number> = {};

  orders.forEach((o) => {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
    totalRevenue += o.totalAmount ?? 0;

    const month = o.orderDate?.slice(0, 7) ?? "unknown";
    monthlyMap[month] = (monthlyMap[month] ?? 0) + 1;
  });

  const statusPie = Object.entries(statusCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const monthlyBar = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, count]) => ({ name: month, value: count }));

  return { statusCounts, totalRevenue, statusPie, monthlyBar };
}

function computeRollStats(rolls: Roll[]) {
  const statusCounts: Record<string, number> = {};
  let totalMeters = 0;
  let scrapMeters = 0;

  rolls.forEach((r) => {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    totalMeters += r.currentQty;
    if (r.status === "SCRAP") {
      scrapMeters += r.currentQty;
    }
  });

  const statusPie = Object.entries(statusCounts).map(([name, value]) => ({
    name,
    value,
  }));

  const scrapRate =
    totalMeters > 0 ? ((scrapMeters / totalMeters) * 100).toFixed(1) : "0";

  return { statusCounts, totalMeters, scrapRate, statusPie };
}

function computeWOStats(workOrders: WorkOrder[]) {
  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};

  workOrders.forEach((wo) => {
    statusCounts[wo.status] = (statusCounts[wo.status] ?? 0) + 1;
    typeCounts[wo.type] = (typeCounts[wo.type] ?? 0) + 1;
  });

  const typePie = Object.entries(typeCounts).map(([name, value]) => ({
    name,
    value,
  }));

  return { statusCounts, typePie };
}

export default function ReportsPage() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const ordersQuery = useQuery({
    queryKey: ["reports-orders", dateFrom, dateTo],
    queryFn: () =>
      orderService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: {
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        },
      }),
  });

  const rollsQuery = useQuery({
    queryKey: ["reports-rolls"],
    queryFn: () =>
      rollService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: {},
      }),
  });

  const woQuery = useQuery({
    queryKey: ["reports-workorders"],
    queryFn: () =>
      workOrderService.getAll({
        page: 1,
        pageSize: 500,
        sortBy: "createdAt",
        sortOrder: "desc",
        filters: {},
      }),
  });

  const orders = ordersQuery.data?.data ?? [];
  const rolls = rollsQuery.data?.data ?? [];
  const workOrders = woQuery.data?.data ?? [];

  const orderStats = computeOrderStats(orders);
  const rollStats = computeRollStats(rolls);
  const woStats = computeWOStats(workOrders);

  const isLoading =
    ordersQuery.isLoading || rollsQuery.isLoading || woQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight">
            Merkezi Raporlama
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="dateFrom" className="text-sm shrink-0">
              Başlangıç
            </Label>
            <Input
              id="dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="dateTo" className="text-sm shrink-0">
              Bitiş
            </Label>
            <Input
              id="dateTo"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 bg-muted animate-pulse rounded-xl"
            />
          ))}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Toplam Sipariş"
              value={orders.length.toString()}
              description="Filtrelenen dönem"
              icon={TrendingUp}
            />
            <KPICard
              title="Toplam Ciro"
              value={`₺${orderStats.totalRevenue.toLocaleString("tr-TR", { minimumFractionDigits: 0 })}`}
              description="Sipariş toplam tutarı"
              icon={TrendingUp}
            />
            <KPICard
              title="Toplam Top"
              value={rolls.length.toString()}
              description={`${rollStats.totalMeters.toFixed(0)}m toplam metraj`}
              icon={TrendingUp}
            />
            <KPICard
              title="Fire Oranı"
              value={`%${rollStats.scrapRate}`}
              description="Toplam metraj içinde fire"
              icon={TrendingUp}
              trend={
                Number(rollStats.scrapRate) > 5
                  ? { value: Number(rollStats.scrapRate), isPositive: false }
                  : { value: Number(rollStats.scrapRate), isPositive: true }
              }
            />
          </div>

          {/* Charts Row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BarChartCard
              title="Aylık Sipariş Sayısı"
              data={orderStats.monthlyBar}
              dataKey="value"
              xAxisKey="name"
            />
            <PieChartCard
              title="Sipariş Durum Dağılımı"
              data={orderStats.statusPie}
            />
          </div>

          {/* Charts Row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PieChartCard
              title="Top Durum Dağılımı"
              data={rollStats.statusPie}
            />
            <PieChartCard
              title="İş Emri Tür Dağılımı"
              data={woStats.typePie}
            />
          </div>

          {/* İş Emri Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">İş Emri Durum Özeti</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {Object.entries(woStats.statusCounts).map(
                  ([status, count]) => (
                    <div
                      key={status}
                      className="text-center p-3 rounded-md bg-muted"
                    >
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground">{status}</p>
                    </div>
                  ),
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
