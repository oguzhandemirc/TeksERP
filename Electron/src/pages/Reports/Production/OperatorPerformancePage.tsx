import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { productionReportsApi, type OperatorPerformanceRow } from "./service";

const columns: ColumnDef<OperatorPerformanceRow>[] = [
  { accessorKey: "fullName", header: "Operatör", cell: ({ row }) => row.original.fullName || row.original.username },
  { accessorKey: "username", header: "Kullanıcı Adı" },
  { accessorKey: "totalOps", header: "Toplam", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "kursunCount", header: "Kurşun", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "qc2Count", header: "QC2", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "tamburCount", header: "Tambur", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "packageCount", header: "Paket", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "subcontractorOps", header: "Fason", cell: ({ getValue }) => fmtInt(getValue() as number) },
];

export function OperatorPerformancePage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "production", "operator-performance", params],
    queryFn: () => productionReportsApi.operatorPerformance(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalOps = rows.reduce((acc, r) => acc + r.totalOps, 0);
  const activeCount = rows.length;

  // En aktif 10 operatörü chart'ta göster
  const chartData = rows.slice(0, 10).map((r) => ({
    name: r.fullName || r.username,
    ops: r.totalOps,
  }));

  return (
    <ReportPageLayout
      title="Operatör Performansı"
      description="Operatör başına toplam ve op-türü kırılımında işlem sayısı."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Aktif Operatör" value={fmtInt(activeCount)} isLoading={isLoading} />
        <MetricCard label="Toplam İşlem" value={fmtInt(totalOps)} isLoading={isLoading} />
        <MetricCard
          label="Operatör Başına Ort."
          value={activeCount === 0 ? "—" : fmtInt(Math.round(totalOps / activeCount))}
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="En Aktif 10 Operatör"
        description="Toplam işlem sayısına göre azalan sıralama."
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

      <DetailTable<OperatorPerformanceRow>
        title="Detay (en yüksek 50)"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
