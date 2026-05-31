import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt } from "../_components/formatters";
import { subcontractReportsApi, type OpenDispatchRow } from "./service";

const columns: ColumnDef<OpenDispatchRow>[] = [
  { accessorKey: "dispatchNo", header: "Sevk No" },
  { accessorKey: "subcontractorName", header: "Fasoncu" },
  { accessorKey: "workOrderNumber", header: "WO" },
  { accessorKey: "dispatchedAt", header: "Sevk Tarihi", cell: ({ getValue }) => fmtDate(getValue() as string) },
  {
    accessorKey: "daysOpen",
    header: "Gün",
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <span className={v >= 14 ? "font-semibold text-destructive" : v >= 7 ? "font-semibold text-warning" : ""}>{fmtInt(v)}</span>;
    },
  },
  {
    accessorKey: "openItems",
    header: "Açık / Toplam",
    cell: ({ row }) => `${fmtInt(row.original.openItems)} / ${fmtInt(row.original.totalItems)}`,
  },
];

export function OpenDispatchesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "subcontract", "open-dispatches"],
    queryFn: () => subcontractReportsApi.openDispatches(),
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
  const over14 = rows.filter((r) => r.daysOpen >= 14).length;
  const totalOpen = rows.reduce((a, r) => a + r.openItems, 0);

  return (
    <ReportPageLayout
      title="Açık Fason Sevkleri"
      description="Henüz geri gelmemiş kalemleri olan fason sevkleri — yaşlandırma."
      showDateRange={false}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Açık Sevk" value={fmtInt(rows.length)} isLoading={isLoading} />
        <MetricCard
          label="14+ Gündür Açık"
          value={fmtInt(over14)}
          tone={over14 > 0 ? "bad" : "ok"}
          isLoading={isLoading}
        />
        <MetricCard label="Toplam Bekleyen Rulo" value={fmtInt(totalOpen)} isLoading={isLoading} />
      </div>

      <DetailTable<OpenDispatchRow>
        data={rows}
        columns={columns}
        isLoading={isLoading}
        emptyLabel="Açık fason sevki yok."
      />
    </ReportPageLayout>
  );
}
