import { useQuery } from "@tanstack/react-query";
import { ChartCard, MetricCard, ReportPageLayout, SimplePieChart } from "../_components";
import { fmtInt, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { qualityReportsApi } from "./service";

const ACTION_LABEL: Record<string, string> = {
  CUT_FOR_SCRAP: "Fire (CUT_FOR_SCRAP)",
  KEPT_AS_A1: "A1 Olarak Tut",
  NO_ACTION: "Aksiyon Alınmadı",
};

export function Qc2DecisionsPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "quality", "qc2-decisions", params],
    queryFn: () => qualityReportsApi.qc2Decisions(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const s = data?.data;
  const pieData = (s?.decisions ?? []).map((d) => ({
    name: ACTION_LABEL[d.action] ?? d.action,
    value: d.count,
  }));

  const scrapPct = s && s.totalErrorsClosed > 0 ? (s.scrapClosed / s.totalErrorsClosed) * 100 : 0;
  const a1Pct = s && s.totalErrorsClosed > 0 ? (s.keptAsA1 / s.totalErrorsClosed) * 100 : 0;

  return (
    <ReportPageLayout
      title="QC2 / Tambur Kararları"
      description="Tambur'da kapatılan hataların kararlarına göre dağılımı."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Tambur'da İşlenen Rulo" value={fmtInt(s?.totalProcessed ?? 0)} isLoading={isLoading} />
        <MetricCard label="Kapatılan Hata" value={fmtInt(s?.totalErrorsClosed ?? 0)} isLoading={isLoading} />
        <MetricCard
          label="Fire Oranı"
          value={fmtPercent(Math.round(scrapPct * 10) / 10)}
          tone={scrapPct >= 10 ? "bad" : scrapPct >= 5 ? "warn" : "ok"}
          isLoading={isLoading}
        />
        <MetricCard
          label="A1 Olarak Tut Oranı"
          value={fmtPercent(Math.round(a1Pct * 10) / 10)}
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="Karar Dağılımı"
        height={320}
        isLoading={isLoading}
        isEmpty={!isLoading && pieData.length === 0}
      >
        <SimplePieChart data={pieData} nameKey="name" valueKey="value" formatValue={(v) => fmtInt(v)} />
      </ChartCard>
    </ReportPageLayout>
  );
}
