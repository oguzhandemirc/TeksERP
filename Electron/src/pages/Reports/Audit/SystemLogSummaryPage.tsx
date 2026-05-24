import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ChartCard,
  DetailTable,
  MetricCard,
  ReportPageLayout,
  SimpleLineChart,
  SimplePieChart,
} from "../_components";
import { fmtDayShort, fmtInt } from "../_components/formatters";
import { actionLabel, tableLabel } from "../_components/audit-labels";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { auditReportsApi } from "./service";

interface TableRow { tableName: string; count: number }
const tableColumns: ColumnDef<TableRow>[] = [
  {
    accessorKey: "tableName",
    header: "Tablo",
    cell: ({ getValue }) => tableLabel(getValue() as string),
  },
  { accessorKey: "count", header: "Kayıt", cell: ({ getValue }) => fmtInt(getValue() as number) },
];

export function SystemLogSummaryPage() {
  const { params } = useReportDateRange(7);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "audit", "system-log-summary", params],
    queryFn: () => auditReportsApi.systemLogSummary(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const s = data?.data;
  const pieData = (s?.byAction ?? []).map((a) => ({
    name: actionLabel(a.action),
    value: a.count,
  }));

  return (
    <ReportPageLayout
      title="Audit Log Özeti"
      description="SystemLog tablosunda aralık içinde oluşan kayıtların kırılımı."
      defaultDays={7}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Toplam Kayıt" value={fmtInt(s?.totalLogs ?? 0)} isLoading={isLoading} />
        <MetricCard
          label="Oluştur"
          value={fmtInt(s?.byAction.find((a) => a.action === "CREATE")?.count ?? 0)}
          isLoading={isLoading}
        />
        <MetricCard
          label="Güncelle"
          value={fmtInt(s?.byAction.find((a) => a.action === "UPDATE")?.count ?? 0)}
          isLoading={isLoading}
        />
        <MetricCard
          label="Sil"
          value={fmtInt(s?.byAction.find((a) => a.action === "DELETE")?.count ?? 0)}
          tone={(s?.byAction.find((a) => a.action === "DELETE")?.count ?? 0) > 0 ? "warn" : "neutral"}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="İşlem Türü"
          height={260}
          isLoading={isLoading}
          isEmpty={!isLoading && pieData.length === 0}
        >
          <SimplePieChart data={pieData} nameKey="name" valueKey="value" formatValue={(v) => fmtInt(v)} />
        </ChartCard>

        <ChartCard
          title="Günlük Aktivite"
          height={260}
          className="lg:col-span-2"
          isLoading={isLoading}
          isEmpty={!isLoading && (s?.daily.length ?? 0) === 0}
        >
          <SimpleLineChart
            data={s?.daily ?? []}
            xKey="day"
            lines={[
              { key: "create", label: "Oluştur" },
              { key: "update", label: "Güncelle" },
              { key: "delete", label: "Sil", color: "#ef4444" },
            ]}
            formatValue={(v) => fmtInt(v)}
            formatCategory={fmtDayShort}
          />
        </ChartCard>
      </div>

      <DetailTable<TableRow>
        title="Tabloya Göre Kayıt Sayısı (en yüksek 30)"
        data={s?.byTable ?? []}
        columns={tableColumns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
