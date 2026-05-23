import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtMeters, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { subcontractReportsApi, type SubcontractPerformanceRow } from "./service";

const columns: ColumnDef<SubcontractPerformanceRow>[] = [
  { accessorKey: "subcontractorName", header: "Fasoncu" },
  { accessorKey: "dispatchCount", header: "Sevk", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "rollsDispatched", header: "Gönderilen Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "rollsReturned", header: "Dönen Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  {
    accessorKey: "rollsOpen",
    header: "Açık",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span className={v > 0 ? "font-semibold text-amber-700" : ""}>{fmtInt(v)}</span>;
    },
  },
  { accessorKey: "qtyDispatched", header: "Gönderilen Metraj", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  {
    accessorKey: "avgTurnaroundDays",
    header: "Ort. Süre (gün)",
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return v === null ? "—" : fmtNum(v);
    },
  },
];

export function PerformancePage() {
  const { params } = useReportDateRange(60);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "subcontract", "performance", params],
    queryFn: () => subcontractReportsApi.performance(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalRolls = rows.reduce((a, r) => a + r.rollsDispatched, 0);
  const totalOpen = rows.reduce((a, r) => a + r.rollsOpen, 0);
  const avgTurnaround =
    rows.filter((r) => r.avgTurnaroundDays !== null).length > 0
      ? rows.reduce((a, r) => a + (r.avgTurnaroundDays ?? 0), 0) /
        rows.filter((r) => r.avgTurnaroundDays !== null).length
      : 0;

  const chartData = rows.slice(0, 10).map((r) => ({
    name: r.subcontractorName,
    rolls: r.rollsDispatched,
  }));

  return (
    <ReportPageLayout
      title="Fasoncu Performansı"
      description="Aralıkta sevk edilen iş — fasoncu başına dönüş oranı ve süre."
      defaultDays={60}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Aktif Fasoncu" value={fmtInt(rows.length)} isLoading={isLoading} />
        <MetricCard label="Toplam Sevk Rulo" value={fmtInt(totalRolls)} isLoading={isLoading} />
        <MetricCard
          label="Henüz Dönmeyen"
          value={fmtInt(totalOpen)}
          tone={totalOpen > 0 ? "warn" : "ok"}
          isLoading={isLoading}
        />
        <MetricCard label="Ort. Süre (gün)" value={fmtNum(Math.round(avgTurnaround * 10) / 10)} isLoading={isLoading} />
      </div>

      <ChartCard
        title="En Çok Sevk Edilen 10 Fasoncu"
        height={Math.max(220, chartData.length * 28 + 40)}
        isLoading={isLoading}
        isEmpty={!isLoading && chartData.length === 0}
      >
        <SimpleBarChart
          data={chartData}
          xKey="name"
          bars={[{ key: "rolls", label: "Rulo" }]}
          formatValue={(v) => fmtInt(v)}
          horizontal
        />
      </ChartCard>

      <DetailTable<SubcontractPerformanceRow>
        title="Detay"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
