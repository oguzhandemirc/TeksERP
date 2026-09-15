import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportAxisBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";
import { ReportExportBar } from "../_components/ReportExportBar";
import { fmtDate, fmtInt } from "../_components/formatters";
import { buildOrderProfileExport } from "./orderProfileExport";
import { customerReportsApi, type CustomerOrderProfileRow } from "./service";

const columns: ColumnDef<CustomerOrderProfileRow>[] = [
  { accessorKey: "customerCode", header: "Kod" },
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "orderCount", header: "Sipariş", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "lineCount", header: "Kalem", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "topItemName", header: "Favori Kumaş", cell: ({ getValue }) => (getValue() as string) || "—" },
  { accessorKey: "topColorName", header: "Favori Renk", cell: ({ getValue }) => (getValue() as string) || "—" },
  {
    accessorKey: "topWidth",
    header: "Favori En",
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return v === null ? "—" : `${v} cm`;
    },
  },
  { accessorKey: "lastOrderDate", header: "Son Sipariş", cell: ({ getValue }) => fmtDate(getValue() as string | null) },
];

const AXIS_KEYS = ["customerId"] as const;

export function OrderProfilePage() {
  const axes = useReportAxes();
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "customer", "order-profile", axes.params],
    queryFn: () => customerReportsApi.orderProfile(axes.params),
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
  const totalOrders = rows.reduce((a, r) => a + r.orderCount, 0);
  const totalLines = rows.reduce((a, r) => a + r.lineCount, 0);
  // Snapshot rapor: dönem yok, "ne zaman alındı" var. Dosya elden ele dolaşırken
  // rakamın hangi ana ait olduğu tek okunur bilgi budur.
  const asOfLabel = `Tüm zamanlar · ${fmtDate(new Date())} itibarıyla`;
  const { secenekler, notes: suzgecNotlari } = useAxisNotes(data, axes.sel, AXIS_KEYS, { destination: true });

  return (
    <ReportPageLayout
      reportKey="customer/order-profile"
      title="Müşteri Sipariş Profili"
      description="Aktif müşterilerin sipariş özeti — favori kumaş, renk, en."
      filters={<ReportAxisBar reportKey="customer/order-profile" axes={axes} secenekler={secenekler} eksenler={AXIS_KEYS} destination />}
      actions={
        <ReportExportBar
          disabled={!data}
          buildSpec={() => (data ? buildOrderProfileExport({ rows, asOfLabel, filterNotes: suzgecNotlari }) : null)}
        />
      }
    >
      <ReportFilterNotes notes={suzgecNotlari} />
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Sipariş Vermiş Müşteri" value={fmtInt(rows.length)} isLoading={isLoading} />
        <MetricCard label="Toplam Sipariş" value={fmtInt(totalOrders)} isLoading={isLoading} />
        <MetricCard label="Toplam Kalem" value={fmtInt(totalLines)} isLoading={isLoading} />
      </div>

      <DetailTable<CustomerOrderProfileRow>
        data={rows}
        columns={columns}
        isLoading={isLoading}
        maxHeight={600}
      />
    </ReportPageLayout>
  );
}
