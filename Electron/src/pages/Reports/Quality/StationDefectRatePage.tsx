import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { qualityReportsApi, type StationDefectRateRow } from "./service";

const STATION_KIND_LABEL: Record<string, string> = {
  RAW_QC: "KK1",
  PROCESS_QC: "KK2/Kurşun",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  OTHER: "Diğer",
};

const columns: ColumnDef<StationDefectRateRow>[] = [
  { accessorKey: "stationName", header: "İstasyon" },
  {
    accessorKey: "stationKind",
    header: "Tür",
    cell: ({ getValue }) => STATION_KIND_LABEL[String(getValue() ?? "")] ?? String(getValue() ?? ""),
  },
  { accessorKey: "throughputRolls", header: "İşlenen Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "defectCount", header: "Hata", cell: ({ getValue }) => fmtInt(getValue() as number) },
  {
    accessorKey: "defectsPerRoll",
    header: "Hata/Rulo",
    cell: ({ getValue }) => fmtNum(getValue() as number),
  },
];

export function StationDefectRatePage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "quality", "station-defect-rate", params],
    queryFn: () => qualityReportsApi.stationDefectRate(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalDefects = rows.reduce((a, r) => a + r.defectCount, 0);
  const totalRolls = rows.reduce((a, r) => a + r.throughputRolls, 0);
  const overallRate = totalRolls > 0 ? Math.round((totalDefects / totalRolls) * 1000) / 1000 : 0;

  const chartData = rows.map((r) => ({
    name: r.stationName,
    rate: r.defectsPerRoll,
  }));

  return (
    <ReportPageLayout
      title="İstasyon Hata Oranı"
      description="Her istasyonun rulo başına ortalama hata tespit sayısı."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Toplam Hata" value={fmtInt(totalDefects)} isLoading={isLoading} />
        <MetricCard label="Toplam Rulo Geçişi" value={fmtInt(totalRolls)} isLoading={isLoading} />
        <MetricCard
          label="Genel Ortalama (hata/rulo)"
          value={fmtNum(overallRate)}
          tone={overallRate >= 1 ? "bad" : overallRate >= 0.3 ? "warn" : "ok"}
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="İstasyon Bazında Hata/Rulo"
        height={Math.max(220, chartData.length * 28 + 40)}
        isLoading={isLoading}
        isEmpty={!isLoading && chartData.length === 0}
      >
        <SimpleBarChart
          data={chartData}
          xKey="name"
          bars={[{ key: "rate", label: "Hata/Rulo", color: "#ef4444" }]}
          formatValue={(v) => fmtNum(v)}
          horizontal
        />
      </ChartCard>

      <DetailTable<StationDefectRateRow>
        title="Detay"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
