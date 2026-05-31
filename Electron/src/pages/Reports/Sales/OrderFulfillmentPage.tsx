import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart, SimplePieChart } from "../_components";
import { fmtDate, fmtInt, fmtMeters, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { salesReportsApi, type OrderFulfillmentSummary } from "./service";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylı",
  PARTIAL_SHIPPED: "Kısmi Sevk",
  COMPLETED: "Tamamlandı",
  CANCELLED: "İptal",
};
const STATUS_TONE: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  APPROVED: "secondary",
  PARTIAL_SHIPPED: "secondary",
  COMPLETED: "default",
  CANCELLED: "destructive",
};

type WorstRow = OrderFulfillmentSummary["worstFulfillment"][number];

const columns: ColumnDef<WorstRow>[] = [
  { accessorKey: "orderNumber", header: "Sipariş No" },
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "status",
    header: "Durum",
    cell: ({ getValue }) => {
      const s = String(getValue() ?? "");
      return <Badge variant={STATUS_TONE[s] ?? "outline"}>{STATUS_LABEL[s] ?? s}</Badge>;
    },
  },
  { accessorKey: "plannedQty", header: "Planlanan", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  { accessorKey: "shippedQty", header: "Sevk Edilen", cell: ({ getValue }) => fmtMeters(getValue() as number) },
  {
    accessorKey: "fulfillmentPct",
    header: "Gerçekleşme",
    cell: ({ getValue }) => fmtPercent(getValue() as number),
  },
  {
    accessorKey: "deadline",
    header: "Termin",
    cell: ({ getValue }) => fmtDate(getValue() as string | null),
  },
];

export function OrderFulfillmentPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "sales", "order-fulfillment", params],
    queryFn: () => salesReportsApi.orderFulfillment(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const summary = data?.data;
  const totalPlanned = summary?.totalPlannedQty ?? 0;
  const totalShipped = summary?.totalShippedQty ?? 0;
  const fulfillment = totalPlanned > 0 ? Math.round((totalShipped / totalPlanned) * 1000) / 10 : 0;

  const pieData = (summary?.byStatus ?? []).map((s) => ({
    name: STATUS_LABEL[s.status] ?? s.status,
    value: s.count,
  }));

  return (
    <ReportPageLayout
      title="Sipariş Gerçekleşme"
      description="Aralıkta açılan siparişlerin durum dağılımı ve hedefe en uzak siparişler."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Toplam Sipariş" value={fmtInt(summary?.totalOrders ?? 0)} isLoading={isLoading} />
        <MetricCard label="Planlanan Metraj" value={fmtMeters(totalPlanned)} isLoading={isLoading} />
        <MetricCard label="Sevk Edilen" value={fmtMeters(totalShipped)} isLoading={isLoading} />
        <MetricCard
          label="Genel Gerçekleşme"
          value={fmtPercent(fulfillment)}
          tone={fulfillment >= 90 ? "ok" : fulfillment >= 70 ? "warn" : "bad"}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Durum Dağılımı"
          height={260}
          isLoading={isLoading}
          isEmpty={!isLoading && pieData.length === 0}
        >
          <SimplePieChart data={pieData} nameKey="name" valueKey="value" formatValue={(v) => fmtInt(v)} />
        </ChartCard>

        <ChartCard
          title="Durum Bazında Metraj"
          height={260}
          isLoading={isLoading}
          isEmpty={!isLoading && (summary?.byStatus.length ?? 0) === 0}
        >
          <SimpleBarChart
            data={(summary?.byStatus ?? []).map((s) => ({
              name: STATUS_LABEL[s.status] ?? s.status,
              planned: s.plannedQty,
              shipped: s.shippedQty,
            }))}
            xKey="name"
            bars={[
              { key: "planned", label: "Planlanan" },
              { key: "shipped", label: "Sevk Edilen", color: "hsl(var(--success))" },
            ]}
            formatValue={(v) => fmtInt(v)}
          />
        </ChartCard>
      </div>

      <DetailTable<WorstRow>
        title="Hedefe En Uzak 25 Açık Sipariş"
        description="PENDING/APPROVED/PARTIAL_SHIPPED siparişler — gerçekleşme yüzdesine göre artan."
        data={summary?.worstFulfillment ?? []}
        columns={columns}
        isLoading={isLoading}
      />
    </ReportPageLayout>
  );
}
