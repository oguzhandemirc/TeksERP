import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { qualityReportsApi, type DefectDistributionRow } from "./service";

const columns: ColumnDef<DefectDistributionRow>[] = [
  { accessorKey: "defectName", header: "Hata Türü" },
  { accessorKey: "count", header: "Toplam", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "processedCount", header: "Kapanan", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "scrapCount", header: "Fire", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "keptAsA1Count", header: "A1 Kalır", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "noActionCount", header: "Aksiyon Yok", cell: ({ getValue }) => fmtInt(getValue() as number) },
];

export function DefectDistributionPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "quality", "defect-distribution", params],
    queryFn: () => qualityReportsApi.defectDistribution(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalDefects = rows.reduce((a, r) => a + r.count, 0);
  const totalScrap = rows.reduce((a, r) => a + r.scrapCount, 0);
  const totalA1 = rows.reduce((a, r) => a + r.keptAsA1Count, 0);

  const chartData = rows.slice(0, 12).map((r) => ({
    name: r.defectName,
    count: r.count,
  }));

  return (
    <ReportPageLayout
      title="Hata Türü Dağılımı"
      description="Tespit edilen hataların DefectType bazında frekansı ve Tambur kararı kırılımı."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Toplam Hata" value={fmtInt(totalDefects)} isLoading={isLoading} />
        <MetricCard label="Fire Sonuçlanan" value={fmtInt(totalScrap)} tone="bad" isLoading={isLoading} />
        <MetricCard label="A1 Olarak Kalan" value={fmtInt(totalA1)} tone="warn" isLoading={isLoading} />
        <MetricCard label="Hata Türü" value={fmtInt(rows.length)} isLoading={isLoading} />
      </div>

      <ChartCard
        title="En Sık 12 Hata"
        height={Math.max(220, chartData.length * 28 + 40)}
        isLoading={isLoading}
        isEmpty={!isLoading && chartData.length === 0}
      >
        <SimpleBarChart
          data={chartData}
          xKey="name"
          bars={[{ key: "count", label: "Adet" }]}
          formatValue={(v) => fmtInt(v)}
          horizontal
        />
      </ChartCard>

      <DetailTable<DefectDistributionRow>
        title="Detay"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
