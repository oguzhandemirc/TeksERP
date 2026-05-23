import { useQuery } from "@tanstack/react-query";
import { ChartCard, MetricCard, ReportPageLayout, SimpleLineChart } from "../_components";
import { fmtDayShort, fmtInt, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { qualityReportsApi } from "./service";

export function KursunApplicationPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "quality", "kursun-application", params],
    queryFn: () => qualityReportsApi.kursunApplication(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const s = data?.data;
  const daily = s?.daily ?? [];

  return (
    <ReportPageLayout
      title="Kurşun Uygulama Oranı"
      description="QC2 tamamlanan rulolardan kaç tanesine Kurşun uygulandı."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="QC2 Tamamlanan" value={fmtInt(s?.qc2Completed ?? 0)} isLoading={isLoading} />
        <MetricCard label="Kurşun Uygulanan" value={fmtInt(s?.kursunApplied ?? 0)} isLoading={isLoading} />
        <MetricCard
          label="Uygulama Oranı"
          value={fmtPercent(s?.applicationPct ?? 0)}
          tone={(s?.applicationPct ?? 0) >= 80 ? "ok" : "warn"}
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="Günlük Trend"
        description="Kurşun ve QC2 günlük sayıları + uygulama yüzdesi."
        height={300}
        isLoading={isLoading}
        isEmpty={!isLoading && daily.length === 0}
      >
        <SimpleLineChart
          data={daily}
          xKey="day"
          lines={[
            { key: "qc2", label: "QC2" },
            { key: "kursun", label: "Kurşun", color: "#22c55e" },
          ]}
          formatValue={(v) => fmtInt(v)}
          formatCategory={fmtDayShort}
        />
      </ChartCard>
    </ReportPageLayout>
  );
}
