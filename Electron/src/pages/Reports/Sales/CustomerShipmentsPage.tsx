import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtMeters, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { salesReportsApi, type CustomerShipmentRow } from "./service";

const columns: ColumnDef<CustomerShipmentRow>[] = [
  { accessorKey: "customerCode", header: "Kod" },
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "shipmentCount", header: "Sevk Sayısı", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "rollCount", header: "Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "totalQty", header: "Metraj", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  {
    accessorKey: "totalWeightKg",
    header: "Ağırlık (kg)",
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return v === null ? "—" : fmtNum(v);
    },
  },
];

export function CustomerShipmentsPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "sales", "customer-shipments", params],
    queryFn: () => salesReportsApi.customerShipments(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const rows = data?.data ?? [];
  const totalQty = rows.reduce((acc, r) => acc + r.totalQty, 0);
  const totalShipments = rows.reduce((acc, r) => acc + r.shipmentCount, 0);
  const activeCustomers = rows.length;

  const top = rows.slice(0, 10).map((r) => ({
    name: r.customerName,
    qty: r.totalQty,
  }));

  return (
    <ReportPageLayout
      title="Müşteri Sevkiyatları"
      description="Aralıkta sevk edilen mal — müşteri başına metraj ve sevkiyat sayısı."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Aktif Müşteri" value={fmtInt(activeCustomers)} isLoading={isLoading} />
        <MetricCard label="Toplam Sevkiyat" value={fmtInt(totalShipments)} isLoading={isLoading} />
        <MetricCard label="Toplam Metraj" value={fmtMeters(totalQty)} isLoading={isLoading} />
      </div>

      <ChartCard
        title="En Çok Sevk Edilen 10 Müşteri"
        height={Math.max(220, top.length * 28 + 40)}
        isLoading={isLoading}
        isEmpty={!isLoading && top.length === 0}
      >
        <SimpleBarChart
          data={top}
          xKey="name"
          bars={[{ key: "qty", label: "Metraj" }]}
          formatValue={(v) => fmtMeters(v)}
          horizontal
        />
      </ChartCard>

      <DetailTable<CustomerShipmentRow>
        title="Detay"
        data={rows}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
