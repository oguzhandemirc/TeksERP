import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportPageLayout, SimpleBarChart, SimpleLineChart } from "../_components";
import { fmtDayShort, fmtInt, fmtMeters } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { productionReportsApi } from "./service";

interface DefectRow {
  defectName: string;
  count: number;
}
const defectColumns: ColumnDef<DefectRow>[] = [
  { accessorKey: "defectName", header: "Hata Türü" },
  { accessorKey: "count", header: "Adet", cell: ({ getValue }) => fmtInt(getValue() as number) },
];

interface DailyRow {
  day: string;
  count: number;
  qty: number;
}

export function ScrapPage() {
  const { params } = useReportDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "production", "scrap", params],
    queryFn: () => productionReportsApi.scrap(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const summary = data?.data;
  const daily: DailyRow[] = summary?.daily ?? [];
  const byDefect: DefectRow[] = summary?.byDefect ?? [];

  return (
    <ReportPageLayout
      title="Fire & Hurda"
      description="Seçilen aralıkta fireye ayrılan rulo sayısı, metraj ve neden olan hata türü."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Toplam Fire Rulo"
          value={fmtInt(summary?.totalScrapRolls ?? 0)}
          tone={summary && summary.totalScrapRolls > 0 ? "bad" : "ok"}
          isLoading={isLoading}
        />
        <MetricCard label="Toplam Fire Metraj" value={fmtMeters(summary?.totalScrapQty ?? 0)} isLoading={isLoading} />
        <MetricCard
          label="Hata Türü Sayısı"
          value={fmtInt(byDefect.length)}
          hint="Tambur'da fire için kesilen hata türleri"
          isLoading={isLoading}
        />
      </div>

      <ChartCard
        title="Günlük Fire Eğilimi"
        height={260}
        isLoading={isLoading}
        isEmpty={!isLoading && daily.length === 0}
      >
        <SimpleLineChart
          data={daily}
          xKey="day"
          lines={[
            { key: "count", label: "Rulo" },
            { key: "qty", label: "Metraj" },
          ]}
          formatValue={(v) => fmtInt(v)}
          formatCategory={fmtDayShort}
        />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Hata Türü Dağılımı"
          height={Math.max(220, byDefect.length * 28 + 40)}
          isLoading={isLoading}
          isEmpty={!isLoading && byDefect.length === 0}
        >
          <SimpleBarChart
            data={byDefect}
            xKey="defectName"
            bars={[{ key: "count", label: "Adet" }]}
            formatValue={(v) => fmtInt(v)}
            horizontal
          />
        </ChartCard>

        <DetailTable<DefectRow>
          title="Hata Detayı"
          data={byDefect}
          columns={defectColumns}
          isLoading={isLoading}
        />
      </div>
    </ReportPageLayout>
  );
}
