import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Layers, Palette, Ruler, Target } from "lucide-react";
import {
  BreakdownTable,
  ChartCard,
  DetailTable,
  MetricCard,
  ReportExportBar,
  ReportPageLayout,
  SimpleBarChart,
} from "../_components";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import { buildDemandExport, demandAnalysisApi, type DemandSpecRow } from "./demandAnalysis";

const specColumns: ColumnDef<DemandSpecRow, unknown>[] = [
  { accessorKey: "itemName", header: "Kumaş" },
  {
    accessorKey: "colorName",
    header: "Renk",
    cell: ({ row }) => {
      const s = row.original;
      if (!s.colorName) return <span className="text-muted-foreground">Renk belirtilmemiş</span>;
      return (
        <span className="flex items-center gap-1.5">
          {s.colorHex ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: s.colorHex }}
              aria-hidden
            />
          ) : null}
          {s.colorName}
        </span>
      );
    },
  },
  {
    accessorKey: "width",
    header: () => <div className="text-right">En</div>,
    cell: ({ getValue }) => {
      const w = getValue() as number | null;
      return <div className="text-right tabular-nums">{w == null ? "—" : fmtNum(w)}</div>;
    },
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Talep</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums">
        {fmtNum(row.original.qty)} m
        <span className="ml-1 text-[10px] text-muted-foreground">
          ({fmtPercent(row.original.sharePct)})
        </span>
      </div>
    ),
  },
  {
    accessorKey: "customerCount",
    header: () => <div className="text-right">Müşteri</div>,
    // Tek müşteriden gelen talep, stoğa üretim için ZAYIF sinyaldir — bu yüzden
    // ayrı sütun ve tekil olan soluk basılır.
    cell: ({ row }) => (
      <div
        className={`text-right tabular-nums ${row.original.customerCount === 1 ? "text-muted-foreground" : ""}`}
      >
        {fmtInt(row.original.customerCount)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          / {fmtInt(row.original.lineCount)} kalem
        </span>
      </div>
    ),
  },
];

export function DemandAnalysisPage() {
  const { params } = useReportDateRange(90);
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "sales", "demand-analysis", params, compare.params],
    queryFn: () => demandAnalysisApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const da = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = params.dateFrom && params.dateTo ? `${params.dateFrom.slice(0, 10)} – ${params.dateTo.slice(0, 10)}` : "";
  const compareLabel = cmpRange ? `${cmpRange.from.slice(0, 10)} – ${cmpRange.to.slice(0, 10)}` : null;

  const spec = useMemo(
    () => () => (da ? buildDemandExport({ da, periodLabel, compareLabel }) : null),
    [da, periodLabel, compareLabel],
  );

  return (
    <ReportPageLayout
      title="Talep Analizi"
      description="Hangi kumaş-renk-en isteniyor — stoğa ne üretileceğinin cevabı."
      defaultDays={90}
      showCompare
      actions={<ReportExportBar disabled={!da} buildSpec={spec} />}
    >
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
