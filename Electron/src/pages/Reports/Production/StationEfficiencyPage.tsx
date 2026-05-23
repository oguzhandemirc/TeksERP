import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtMeters, fmtMinutes } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { productionReportsApi, type StationEfficiencyRow } from "./service";

const STATION_KIND_LABEL: Record<string, string> = {
  RAW_QC: "KK1",
  PROCESS_QC: "KK2/Kurşun",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  OTHER: "Diğer",
};

const columns: ColumnDef<StationEfficiencyRow>[] = [
  { accessorKey: "stationName", header: "İstasyon" },
  {
    accessorKey: "stationKind",
    header: "Tür",
    cell: ({ getValue }) => STATION_KIND_LABEL[String(getValue() ?? "")] ?? String(getValue() ?? ""),
  },
  { accessorKey: "rollCount", header: "Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "qtyIn", header: "Giren (m)", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "qtyOut", header: "Çıkan (m)", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  {
    accessorKey: "avgDurationMin",
    header: "Ort. Süre",
    cell: ({ getValue }) => fmtMinutes(getValue() as number | null),
  },
  { accessorKey: "stillIn", header: "İçeride", cell: ({ getValue }) => fmtInt(getValue() as number) },
];

export function StationEfficiencyPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "production", "station-efficiency", params],
    queryFn: () => productionReportsApi.stationEfficiency(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalRolls = rows.reduce((acc, r) => acc + r.rollCount, 0);
  const totalIn = rows.reduce((acc, r) => acc + r.qtyIn, 0);
  const totalOut = rows.reduce((acc, r) => acc + r.qtyOut, 0);
  const stillIn = rows.reduce((acc, r) => acc + r.stillIn, 0);

  const chartData = rows.map((r) => ({
    name: r.stationName,
    rolls: r.rollCount,
  }));

  return (
    <ReportPageLayout
      title="İstasyon Verimliliği"
      description="Seçilen tarih aralığında istasyon bazında giriş/çıkış, süre ve bekleyen rulo."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Toplam Rulo Geçişi" value={fmtInt(totalRolls)} isLoading={isLoading} />
        <MetricCard label="Toplam Giren" value={fmtMeters(totalIn)} isLoading={isLoading} />
        <MetricCard label="Toplam Çıkan" value={fmtMeters(totalOut)} isLoading={isLoading} />
        <MetricCard
          label="Şu An İçeride"
          value={fmtInt(stillIn)}
          tone={stillIn > 0 ? "warn" : "neutral"}
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="İstasyon Bazında İşlenen Rulo"
        description="Tarih aralığı içinde her istasyondan geçen toplam rulo sayısı."
        height={300}
        isLoading={isLoading}
        isEmpty={!isLoading && chartData.length === 0}
      >
        <SimpleBarChart
          data={chartData}
          xKey="name"
          bars={[{ key: "rolls", label: "Rulo" }]}
          formatValue={(v) => fmtInt(v)}
        />
      </ChartCard>

      <DetailTable<StationEfficiencyRow>
        title="Detay"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
