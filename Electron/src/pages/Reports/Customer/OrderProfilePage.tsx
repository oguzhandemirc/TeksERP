import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt } from "../_components/formatters";
import { customerReportsApi, type CustomerOrderProfileRow } from "./service";

const columns: ColumnDef<CustomerOrderProfileRow>[] = [
  { accessorKey: "customerCode", header: "Kod" },
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "orderCount", header: "Sipariş", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "lineCount", header: "Kalem", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "topItemName", header: "Favori Ürün", cell: ({ getValue }) => (getValue() as string) || "—" },
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

export function OrderProfilePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "customer", "order-profile"],
    queryFn: () => customerReportsApi.orderProfile(),
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];
  const totalOrders = rows.reduce((a, r) => a + r.orderCount, 0);
  const totalLines = rows.reduce((a, r) => a + r.lineCount, 0);

  return (
    <ReportPageLayout
      title="Müşteri Sipariş Profili"
      description="Aktif müşterilerin sipariş özeti — favori ürün, renk, en."
      showDateRange={false}
    >
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
