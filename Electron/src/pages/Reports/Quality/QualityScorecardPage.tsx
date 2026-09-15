import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Award, Layers, Ruler } from "lucide-react";
import { ChartCard, MetricCard, ReportPageLayout, SimpleLineChart } from "../_components";
import { ReportExportBar } from "../_components/ReportExportBar";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import { qualityReportsApi } from "./service";
import { ScorecardBreakdown } from "./ScorecardBreakdown";
import { buildScorecardExport } from "./scorecardExport";

/** "%92,4 (önceki %88,1)" — kartın altındaki karşılaştırma cümlesi. */
function compareHint(now: number | undefined, prev: number | undefined, unit: string): string | undefined {
  if (prev === undefined || now === undefined) return undefined;
  const d = Math.round((now - prev) * 10) / 10;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  return `Önceki dönem ${fmtNum(prev)}${unit} · ${arrow} ${fmtNum(Math.abs(d))}${unit}`;
}

export function QualityScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("quality/scorecard");
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "quality", "scorecard", params, compare.params],
    queryFn: () => qualityReportsApi.scorecard({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const topName = sc?.summary.topGrade?.name ?? "Üst kalite";

  return (
    <ReportPageLayout
      reportKey="quality/scorecard"
      title="Kalite Karnesi"
      description="Üretimi biten kumaşın metraj ağırlıklı kalite dağılımı — kumaş, renk ve fason kırılımıyla."
      showCompare
      actions={
        <ReportExportBar
          disabled={!sc}
          buildSpec={() =>
            sc ? buildScorecardExport({ sc, periodLabel, compareLabel }) : null
          }
        />
      }
    >
      {/* Kapsam bandı: karneye güvenilip güvenilmeyeceğini bu sayı belirler.
          Gizlenirse rapor "eksiksiz" gibi okunur — sessiz eksik en kötüsüdür. */}
      {sc && sc.unanchoredRollCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{fmtInt(sc.unanchoredRollCount)} top</strong> üretim tarihi bilinmediği için hiçbir
            döneme dahil edilmedi. Bunlar bu karnede (ve diğer dönem raporlarında) görünmez.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label={`${topName} oranı`}
          value={fmtPercent(sc?.summary.topGrade?.pct)}
          hint={
            compareHint(sc?.summary.topGrade?.pct, sc?.summary.prevTopGradePct, "%") ??
            "Metraj ağırlıklı — top adedi değil"
          }
          icon={Award}
          tone={
            sc?.summary.topGrade === null || sc?.summary.topGrade === undefined
              ? "neutral"
              : sc.summary.topGrade.pct >= 90
                ? "ok"
                : sc.summary.topGrade.pct >= 75
                  ? "warn"
                  : "bad"
          }
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Üretilen metraj"
          value={`${fmtNum(sc?.summary.totalQty)} m`}
          hint={compareHint(sc?.summary.totalQty, sc?.summary.prevTotalQty, " m")}
          icon={Ruler}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Biten top"
          value={fmtInt(sc?.summary.rollCount)}
          hint={
            hasCompare && sc?.summary.prevRollCount !== undefined
              ? `Önceki dönem ${fmtInt(sc.summary.prevRollCount)}`
              : undefined
          }
          icon={Layers}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Kalitesi girilmemiş"
          value={`${fmtNum(sc?.summary.ungradedQty)} m`}
          // "0" ile "bilinmiyor" farkı: bu metraj kötü kalite DEĞİL, kararı
          // verilmemiş kumaştır — oranı aşağı çeker ve sebebi burada yazar.
          hint="Kalite kararı verilmemiş — oranı aşağı çeker"
          tone={sc && sc.summary.ungradedQty > 0 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title={`Günlük seyir — ${topName} oranı`}
        height={260}
        isLoading={query.isLoading}
        isEmpty={!query.isLoading && (sc?.daily.length ?? 0) === 0}
      >
        <SimpleLineChart
          data={sc?.daily ?? []}
          xKey="day"
          lines={[
            { key: "topGradePct", label: `${topName} %` },
            { key: "totalQty", label: "Toplam metraj" },
          ]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      {sc ? (
        <>
          <ScorecardBreakdown
            title="Kumaş Bazında"
            description="Hangi kumaşta kalite düşüyor — en çok üretilen üstte."
            labelHeader="Kumaş"
            rows={sc.byItem}
            sc={sc}
            hasCompare={hasCompare}
            isLoading={query.isLoading}
          />
          <ScorecardBreakdown
            title="Renk Bazında"
            description="Renk/reçete kaynaklı kalite farkları."
            labelHeader="Renk"
            rows={sc.byColor}
            sc={sc}
            hasCompare={hasCompare}
            isLoading={query.isLoading}
          />
          <ScorecardBreakdown
            title="Fason Bazında"
            description="Fason dönüşü topların kalitesi ile fabrika içi üretimin karşılaştırması."
            labelHeader="Kaynak"
            rows={sc.bySubcontractor}
            sc={sc}
            hasCompare={hasCompare}
            isLoading={query.isLoading}
          />
        </>
      ) : null}
    </ReportPageLayout>
  );
}
