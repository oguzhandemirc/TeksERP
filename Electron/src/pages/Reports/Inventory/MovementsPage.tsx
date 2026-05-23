import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartCard, MetricCard, ReportPageLayout, SimpleLineChart } from "../_components";
import { fmtDayShort, fmtInt } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { inventoryReportsApi, type DailyMovementRow } from "./service";

export function MovementsPage() {
  const { params } = useReportDateRange(14);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "inventory", "movements", params],
    queryFn: () => inventoryReportsApi.dailyMovements(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = useMemo(() => data?.data ?? [], [data]);

  // Day -> stationName -> count pivot for line chart.
  const { chartRows, stations } = useMemo(() => pivot(rows), [rows]);
  const totalMovements = rows.reduce((a, r) => a + r.movementCount, 0);

  return (
    <ReportPageLayout
      title="Hareket Geçmişi"
      description="İstasyon × gün matrisinde rulo giriş hareketleri (RollMovement.enteredAt)."
      defaultDays={14}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Toplam Hareket" value={fmtInt(totalMovements)} isLoading={isLoading} />
        <MetricCard label="Aktif İstasyon" value={fmtInt(stations.length)} isLoading={isLoading} />
        <MetricCard label="Gün Sayısı" value={fmtInt(chartRows.length)} isLoading={isLoading} />
      </div>

      <ChartCard
        title="Günlük Hareket Akışı"
        description="İstasyon bazında günlük rulo giriş sayısı."
        height={340}
        isLoading={isLoading}
        isEmpty={!isLoading && chartRows.length === 0}
      >
        <SimpleLineChart
          data={chartRows}
          xKey="day"
          lines={stations.map((s) => ({ key: s, label: s }))}
          formatValue={(v) => fmtInt(v)}
          formatCategory={fmtDayShort}
        />
      </ChartCard>
    </ReportPageLayout>
  );
}

function pivot(rows: DailyMovementRow[]) {
  const byDay = new Map<string, Record<string, number>>();
  const stationSet = new Set<string>();
  for (const r of rows) {
    stationSet.add(r.stationName);
    if (!byDay.has(r.day)) byDay.set(r.day, {});
    const row = byDay.get(r.day)!;
    row[r.stationName] = (row[r.stationName] ?? 0) + r.movementCount;
  }
  const days = Array.from(byDay.keys()).sort();
  const stations = Array.from(stationSet).sort();
  const chartRows = days.map((d) => {
    const base: Record<string, number | string> = { day: d };
    for (const s of stations) base[s] = byDay.get(d)?.[s] ?? 0;
    return base;
  });
  return { chartRows, stations };
}
