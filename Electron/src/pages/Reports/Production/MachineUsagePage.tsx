import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { productionReportsApi, type MachineUsageRow } from "./service";

const STATION_KIND_LABEL: Record<string, string> = {
  RAW_QC: "KK1",
  PROCESS_QC: "KK2/Kurşun",
  TAMBUR: "Tambur",
  SUBCONTRACTOR: "Fason",
  OTHER: "Diğer",
};

const columns: ColumnDef<MachineUsageRow>[] = [
  { accessorKey: "machineName", header: "Makine" },
  { accessorKey: "stationName", header: "İstasyon" },
  {
    accessorKey: "stationKind",
    header: "Tür",
    cell: ({ getValue }) => STATION_KIND_LABEL[String(getValue() ?? "")] ?? String(getValue() ?? ""),
  },
  { accessorKey: "opCount", header: "İşlem", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "rollCount", header: "Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
];

export function MachineUsagePage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "production", "machine-usage", params],
    queryFn: () => productionReportsApi.machineUsage(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalOps = rows.reduce((acc, r) => acc + r.opCount, 0);
  const activeMachines = rows.length;

  const chartData = rows.slice(0, 12).map((r) => ({
    name: `${r.machineName} (${r.stationName})`,
    ops: r.opCount,
  }));

  return (
    <ReportPageLayout
      title="Makine Kullanımı"
      description="Makine başına işlem ve farklı rulo sayısı — aktif/atıl kıyaslaması."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Aktif Makine" value={fmtInt(activeMachines)} isLoading={isLoading} />
        <MetricCard label="Toplam İşlem" value={fmtInt(totalOps)} isLoading={isLoading} />
        <MetricCard
          label="Makine Başına Ort."
          value={activeMachines === 0 ? "—" : fmtInt(Math.round(totalOps / activeMachines))}
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="En Aktif 12 Makine"
        height={Math.max(220, chartData.length * 28 + 40)}
        isLoading={isLoading}
        isEmpty={!isLoading && chartData.length === 0}
      >
        <SimpleBarChart
          data={chartData}
          xKey="name"
          bars={[{ key: "ops", label: "İşlem" }]}
          formatValue={(v) => fmtInt(v)}
          horizontal
        />
      </ChartCard>

      <DetailTable<MachineUsageRow>
        title="Detay"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
