import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Layers, Palette, Ruler, Target } from "lucide-react";
import {
  BreakdownTable,
  ChartCard,
  DetailTable,
  MetricCard,
  ReportAxisBar,
  ReportExportBar,
  ReportFilterNotes,
  ReportPageLayout,
  SimpleBarChart,
} from "../_components";
import { fmtInt, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";
import { buildDemandExport, demandAnalysisApi } from "./demandAnalysis";
import { specColumns } from "./demandAnalysisColumns";
import type { DemandSpecRow } from "./demandAnalysis";


const AXIS_KEYS = ["customerId", "itemId", "colorId"] as const;

export function DemandAnalysisPage() {
  const { params } = useReportDateRange("sales/demand-analysis");
  const compare = useReportCompare();
  const axes = useReportAxes();

  const query = useQuery({
    queryKey: ["reports", "sales", "demand-analysis", params, compare.params, axes.params],
    queryFn: () => demandAnalysisApi.get({ ...params, ...compare.params, ...axes.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const da = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = params.dateFrom && params.dateTo ? `${params.dateFrom.slice(0, 10)} – ${params.dateTo.slice(0, 10)}` : "";
  const compareLabel = cmpRange ? `${cmpRange.from.slice(0, 10)} – ${cmpRange.to.slice(0, 10)}` : null;

  const { secenekler, notes: suzgecNotlari } = useAxisNotes(query.data, axes.sel, AXIS_KEYS, { destination: true });
  const spec = useMemo(
    () => () => (da ? buildDemandExport({ da, periodLabel, compareLabel, filterNotes: suzgecNotlari }) : null),
    [da, periodLabel, compareLabel, suzgecNotlari],
  );

  return (
    <ReportPageLayout
      reportKey="sales/demand-analysis"
      title="Talep Analizi"
      description="Hangi kumaş-renk-en isteniyor — stoğa ne üretileceğinin cevabı."
      showCompare
      filters={<ReportAxisBar reportKey="sales/demand-analysis" showCompare axes={axes} secenekler={secenekler} eksenler={AXIS_KEYS} destination />}
      actions={<ReportExportBar disabled={!da} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={suzgecNotlari} />
      <p className="text-xs text-muted-foreground">
        Talep <strong>kumaş + renk + en</strong> üçlüsünde sayılır: depodaki mal ancak birebir
        aynı üçlüyü karşılar. Aylık seri ise seçili aralıktan <strong>bağımsızdır</strong> — son
        24 ayı gösterir, çünkü 30 günlük pencerede mevsim yoktur.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Toplam talep"
          value={`${fmtNum(da?.summary.totalQty)} m`}
          hint={
            da?.summary.prevTotalQty !== undefined
              ? `Önceki dönem ${fmtNum(da.summary.prevTotalQty)} m`
              : `${fmtInt(da?.summary.lineCount)} kalem`
          }
          icon={Ruler}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Çekirdek spec"
          value={fmtInt(da?.summary.coreSpecCount)}
          hint={da ? `Talebin %80'ini taşıyor — toplam ${fmtInt(da.summary.specCount)} spec` : undefined}
          icon={Target}
          tone="ok"
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Farklı kumaş"
          value={fmtInt(da?.summary.itemCount)}
          hint={da ? `${fmtInt(da.summary.colorCount)} farklı renk` : undefined}
          icon={Layers}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Renksiz talep"
          value={`${fmtNum(da?.summary.colorlessQty)} m`}
          hint="Renk belirtilmemiş — serbest boyanabilir"
          icon={Palette}
          isLoading={query.isLoading}
        />
      </div>

      {da && da.summary.specsOmitted > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{fmtInt(da.summary.specsOmitted)} spec</strong> listeye sığmadı (tavan 300).
            Özet rakamları tümünü kapsar; aşağıdaki liste kapsamaz.
          </span>
        </div>
      ) : null}

      <ChartCard
        title="Aylık talep (son 24 ay)"
        description="Mevsimsellik. Ay sınırı fabrika saat dilimine göre kesilir — ayın ilk gecesi doğru aya yazılır."
        isEmpty={!da || da.monthly.length === 0}
        isLoading={query.isLoading}
      >
        <SimpleBarChart
          data={da?.monthly ?? []}
          xKey="month"
          bars={[{ key: "qty", label: "Metraj (m)" }]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      <DetailTable<DemandSpecRow>
        title="En çok istenen spec'ler"
        description="Metraja göre sıralı. 'Müşteri' sütunu farklı müşteri sayısıdır — tek müşteriden gelen talep stoğa üretim için zayıf sinyaldir."
        data={da?.specs ?? []}
        columns={specColumns}
        isLoading={query.isLoading}
      />

      <BreakdownTable
        title="Kumaş kırılımı"
        labelHeader="Kumaş"
        countHeader="Kalem"
        rows={da?.byItem ?? []}
        totalQty={da?.summary.totalQty}
        hasCompare={hasCompare}
        isLoading={query.isLoading}
      />

      <BreakdownTable
        title="Renk kırılımı"
        description="Renk belirtilmemiş talep ayrı satırda — ham/serbest boyanacak mal."
        labelHeader="Renk"
        countHeader="Kalem"
        rows={da?.byColor ?? []}
        totalQty={da?.summary.totalQty}
        hasCompare={hasCompare}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
