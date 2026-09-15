import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportPageLayout } from "../_components";
import { ReportExportBar } from "../_components/ReportExportBar";
import { fmtDate, fmtDateTime, fmtInt } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { auditReportsApi, type UserActivityRow } from "./service";
import { buildUserActivityExport } from "./userActivityExport";

const columns: ColumnDef<UserActivityRow>[] = [
  {
    accessorKey: "fullName",
    header: "Kullanıcı",
    cell: ({ row }) => row.original.fullName || row.original.username || "(sistem)",
  },
  { accessorKey: "username", header: "Kullanıcı Adı", cell: ({ getValue }) => (getValue() as string) || "—" },
  { accessorKey: "totalCount", header: "Toplam", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "createCount", header: "Oluştur", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "updateCount", header: "Güncelle", cell: ({ getValue }) => fmtInt(getValue() as number) },
  {
    accessorKey: "deleteCount",
    header: "Sil",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span className={v > 0 ? "font-semibold text-warning" : ""}>{fmtInt(v)}</span>;
    },
  },
  {
    accessorKey: "lastActionAt",
    header: "Son İşlem",
    cell: ({ getValue }) => fmtDateTime(getValue() as string | null),
  },
];

export function UserActivityPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("audit/user-activity");
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "audit", "user-activity", params],
    queryFn: () => auditReportsApi.userActivity(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalActions = rows.reduce((a, r) => a + r.totalCount, 0);
  const totalDeletes = rows.reduce((a, r) => a + r.deleteCount, 0);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;

  return (
    <ReportPageLayout
      reportKey="audit/user-activity"
      title="Kullanıcı Aktivitesi"
      description="Aralıkta her kullanıcının yaptığı CUD işlem sayısı ve son işlem zamanı."
      actions={
        <ReportExportBar
          disabled={!data}
          buildSpec={() => (data ? buildUserActivityExport({ rows, periodLabel }) : null)}
        />
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Aktif Kullanıcı" value={fmtInt(rows.length)} isLoading={isLoading} />
        <MetricCard label="Toplam İşlem" value={fmtInt(totalActions)} isLoading={isLoading} />
        <MetricCard
          label="Toplam Silme"
          value={fmtInt(totalDeletes)}
          tone={totalDeletes > 0 ? "warn" : "neutral"}
          isLoading={isLoading}
        />
      </div>

      <DetailTable<UserActivityRow> data={rows} columns={columns} isLoading={isLoading} />
    </ReportPageLayout>
  );
}
