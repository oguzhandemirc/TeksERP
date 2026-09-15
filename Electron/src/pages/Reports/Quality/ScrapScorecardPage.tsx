import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertOctagon, Bug, Percent, Trash2 } from "lucide-react";
import {
  BreakdownTable,
  ChartCard,
  DetailTable,
  MetricCard,
  ReportExportBar,
  ReportPageLayout,
  SimpleLineChart,
} from "../_components";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import { qualityReportsApi, type DefectDetectionRow } from "./service";
import { buildScrapExport } from "./scrapExport";

function hint(now: number | undefined, prev: number | undefined, unit: string): string | undefined {
  if (prev === undefined || now === undefined) return undefined;
  const d = Math.round((now - prev) * 10) / 10;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  return `Önceki dönem ${fmtNum(prev)}${unit} · ${arrow} ${fmtNum(Math.abs(d))}${unit}`;
}

const detectionColumns: ColumnDef<DefectDetectionRow, unknown>[] = [
  { accessorKey: "label", header: "Hata / İstasyon" },
  {
    accessorKey: "count",
    header: () => <div className="text-right">Tespit</div>,
    cell: ({ getValue }) => <div className="text-right font-medium tabular-nums">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "cutCount",
    header: () => <div className="text-right">Kesildi</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums text-muted-foreground">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "noCutCount",
    header: () => <div className="text-right">Tutuldu</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums text-muted-foreground">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "openCount",
    header: () => <div className="text-right">Açık</div>,
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return <div className={`text-right tabular-nums ${v > 0 ? "text-warning" : "text-muted-foreground"}`}>{fmtInt(v)}</div>;
    },
  },
];

export function ScrapScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("quality/scrap-scorecard");
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "quality", "scrap-scorecard", params, compare.params],
    queryFn: () => qualityReportsApi.scrapScorecard({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;
  const scrapQty = sc?.summary.scrapQty ?? 0;

  const spec = useMemo(
    () => () => (sc ? buildScrapExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );

  return (
    <ReportPageLayout
      reportKey="quality/scrap-scorecard"
      title="Fire Karnesi"
      description="Hurdaya ayrılan metraj ve nedenleri — Kalite Karnesi ile aynı üretim evreni üzerinden."
      showCompare
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Fire oranı"
          value={fmtPercent(sc?.summary.scrapPct)}
          hint={
            hint(sc?.summary.scrapPct, sc?.summary.prevScrapPct, "%") ??
            `Toplam üretim ${fmtNum(sc?.summary.producedQty)} m üzerinden`
          }
          icon={Percent}
          tone={sc === undefined ? "neutral" : sc.summary.scrapPct <= 2 ? "ok" : sc.summary.scrapPct <= 5 ? "warn" : "bad"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Hurda metraj"
          value={`${fmtNum(scrapQty)} m`}
          hint={hint(sc?.summary.scrapQty, sc?.summary.prevScrapQty, " m")}
          icon={Trash2}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Hurda top"
          value={fmtInt(sc?.summary.scrapRollCount)}
          icon={Bug}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Tespit edilen hata"
          value={fmtInt(sc?.summary.defectsDetected)}
          // Bu sayacın çıpası FARKLI (hatanın görüldüğü an) — hint bunu söylemezse
          // kullanıcı iki rakamı aynı pencereye ait sanıp toplamaya çalışır.
          hint={
            sc && sc.summary.defectsOpen > 0
              ? `${fmtInt(sc.summary.defectsOpen)} tanesi hâlâ karara bağlanmadı`
              : "Hatanın görüldüğü ana göre — hurda metrajıyla toplanmaz"
          }
          icon={AlertOctagon}
          tone={sc && sc.summary.defectsOpen > 0 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Günlük hurda seyri"
        height={240}
        isLoading={query.isLoading}
        isEmpty={!query.isLoading && (sc?.daily.length ?? 0) === 0}
      >
        <SimpleLineChart
          data={sc?.daily ?? []}
          xKey="day"
          lines={[
            { key: "scrapQty", label: "Hurda (m)" },
            { key: "scrapCount", label: "Top" },
          ]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      {sc ? (
        <>
          <BreakdownTable
            title="Hurdanın nedeni"
            description="Hurdaya ayrılan topların hata türü kırılımı. Çok hatalı topta metraj ilk tespite atfedilir."
            labelHeader="Hata türü"
            rows={sc.scrapByDefect}
            totalQty={scrapQty}
            qtyHeader="Hurda"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde hurdaya ayrılan top yok"
          />
          <BreakdownTable
            title="Kumaş Bazında"
            labelHeader="Kumaş"
            rows={sc.byItem}
            totalQty={scrapQty}
            qtyHeader="Hurda"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde hurdaya ayrılan top yok"
          />
          <BreakdownTable
            title="Kaynak Bazında"
            description="Fabrika içi üretim ile fason dönüşü malın hurda karşılaştırması."
            labelHeader="Kaynak"
            rows={sc.bySource}
            totalQty={scrapQty}
            qtyHeader="Hurda"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde hurdaya ayrılan top yok"
          />
          <DetailTable
            title="Tespit edilen hatalar — türe göre"
            description="AYRI ZAMAN ÇIPASI: hatanın görüldüğü ana göre, ADET olarak. Yukarıdaki metrajlarla toplanmaz."
            data={sc.detectionByDefect}
            columns={detectionColumns}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde hata kaydı yok"
          />
          <DetailTable
            title="Tespit edilen hatalar — istasyona göre"
            description="Hatayı hangi istasyon yakaladı. Erken yakalayan istasyon iyidir; sona kalan hata daha pahalıdır."
            data={sc.detectionByStation}
            columns={detectionColumns}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde hata kaydı yok"
          />
        </>
      ) : null}
    </ReportPageLayout>
  );
}
