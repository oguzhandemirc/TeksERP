import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtMeters } from "../_components/formatters";
import { inventoryReportsApi, type StockDistribution } from "./service";

type ItemColorRow = StockDistribution["byItemColor"][number];

const columns: ColumnDef<ItemColorRow>[] = [
  { accessorKey: "itemName", header: "Ürün" },
  { accessorKey: "colorName", header: "Renk" },
  { accessorKey: "rollCount", header: "Rulo", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "totalQty", header: "Metraj", cell: ({ getValue }) => fmtMeters(getValue() as number) },
];

export function StockDistributionPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "inventory", "stock-distribution"],
    queryFn: () => inventoryReportsApi.stockDistribution(),
    staleTime: 30_000,
  });

  const d = data?.data;
  const widthData = d?.byWidth ?? [];
  const itemColorRows = d?.byItemColor ?? [];

  return (
    <ReportPageLayout
      title="Stok Dağılımı"
      description="Mevcut stokta (WAREHOUSE vb.) renk, ürün ve en kırılımı."
      showDateRange={false}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard label="Toplam Rulo" value={fmtInt(d?.totalRolls ?? 0)} isLoading={isLoading} />
        <MetricCard label="Toplam Metraj" value={fmtMeters(d?.totalQty ?? 0)} isLoading={isLoading} />
      </div>

      <ChartCard
        title="En Dağılımı"
        height={260}
        isLoading={isLoading}
        isEmpty={!isLoading && widthData.length === 0}
      >
        <SimpleBarChart
          data={widthData}
          xKey="widthBucket"
          bars={[
            { key: "rollCount", label: "Rulo" },
            { key: "totalQty", label: "Metraj", color: "#f59e0b" },
          ]}
          formatValue={(v) => fmtInt(v)}
        />
      </ChartCard>

      <DetailTable<ItemColorRow>
        title="Ürün × Renk Detayı"
        data={itemColorRows}
        columns={columns}
        isLoading={isLoading}
        maxHeight={600}
      />
    </ReportPageLayout>
  );
}
