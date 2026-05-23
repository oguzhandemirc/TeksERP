import { useQuery } from "@tanstack/react-query";
import { ChartCard, MetricCard, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtMeters } from "../_components/formatters";
import { inventoryReportsApi } from "./service";

export function RollAgingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "inventory", "roll-aging"],
    queryFn: () => inventoryReportsApi.rollAging(),
    staleTime: 30_000,
  });

  const summary = data?.data;
  const buckets = summary?.buckets ?? [];

  return (
    <ReportPageLayout
      title="Rulo Yaşlandırma"
      description="Depodaki (WAREHOUSE) ruloların bekleme süresi dağılımı — anlık görüntü."
      showDateRange={false}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Depoda Toplam Rulo" value={fmtInt(summary?.totalRolls ?? 0)} isLoading={isLoading} />
        <MetricCard label="Toplam Metraj" value={fmtMeters(summary?.totalQty ?? 0)} isLoading={isLoading} />
        <MetricCard
          label="En Eski (gün)"
          value={fmtInt(summary?.oldestDays ?? 0)}
          tone={
            summary && summary.oldestDays >= 30
              ? "bad"
              : summary && summary.oldestDays >= 14
                ? "warn"
                : "ok"
          }
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="Yaş Aralıkları"
        height={280}
        isLoading={isLoading}
        isEmpty={!isLoading && buckets.length === 0}
      >
        <SimpleBarChart
          data={buckets}
          xKey="bucket"
          bars={[
            { key: "count", label: "Rulo" },
            { key: "qty", label: "Metraj", color: "#f59e0b" },
          ]}
          formatValue={(v) => fmtInt(v)}
        />
      </ChartCard>
    </ReportPageLayout>
  );
}
