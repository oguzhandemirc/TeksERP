import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, PackageX, Percent, Truck } from "lucide-react";
import {
  BreakdownTable,
  ChartCard,
  MetricCard,
  ReportExportBar,
  ReportPageLayout,
  SimpleLineChart,
} from "../_components";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import { buildReturnExport, returnScorecardApi } from "./returnScorecard";

function hint(now: number | undefined, prev: number | undefined, unit: string): string | undefined {
  if (prev === undefined || now === undefined) return undefined;
  const d = Math.round((now - prev) * 10) / 10;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  return `Önceki dönem ${fmtNum(prev)}${unit} · ${arrow} ${fmtNum(Math.abs(d))}${unit}`;
}

export function ReturnScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("sales/return-scorecard");
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "sales", "return-scorecard", params, compare.params],
    queryFn: () => returnScorecardApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;
  const returnQty = sc?.summary.returnQty ?? 0;

  const spec = useMemo(
    () => () => (sc ? buildReturnExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );

  const reasonGaps = (sc?.summary.freeTextReasonCount ?? 0) + (sc?.summary.missingReasonCount ?? 0);

  return (
    <ReportPageLayout
      reportKey="sales/return-scorecard"
      title="İade Karnesi"
      description="Müşteriden geri gelen mal — oran, neden ve müşteri kırılımı."
      showCompare
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      {/* Oranın TANIMI ekranda da durur: "kohort değil" uyarısı olmadan kullanıcı
          rakamı "bu ay sevk ettiğimin %X'i geri geldi" diye okur ve yanılır. */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          İade oranı = <strong>dönemde iade alınan</strong> / <strong>dönemde sevk edilen</strong>. İki küme
          farklı sevkiyatlara ait olabilir (bu ay gelen iade geçen ayın malı olabilir) — bir kohort oranı
          değildir. Sevk metrajı brüttür: iade, sevk rakamından düşülmez.
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="İade oranı"
          value={fmtPercent(sc?.summary.returnPct)}
          hint={
            hint(sc?.summary.returnPct, sc?.summary.prevReturnPct, "%") ??
            `Sevk ${fmtNum(sc?.summary.shippedQty)} m üzerinden`
          }
          icon={Percent}
          tone={sc === undefined ? "neutral" : sc.summary.returnPct <= 1 ? "ok" : sc.summary.returnPct <= 3 ? "warn" : "bad"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="İade metraj"
          value={`${fmtNum(returnQty)} m`}
          hint={hint(sc?.summary.returnQty, sc?.summary.prevReturnQty, " m")}
          icon={PackageX}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Sevk metraj (brüt)"
          value={`${fmtNum(sc?.summary.shippedQty)} m`}
          hint={hint(sc?.summary.shippedQty, sc?.summary.prevShippedQty, " m") ?? "Doğrudan sevkler dahil"}
          icon={Truck}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="İade top"
          value={fmtInt(sc?.summary.returnRollCount)}
          // Sebep boşlukları bir VERİ KALİTESİ sinyalidir: yüksekse katalog
          // eksiktir (operatör "diğer"e kaçıyor), rapor değil katalog düzeltilir.
          hint={
            reasonGaps > 0
              ? `${fmtInt(reasonGaps)} iadenin nedeni katalogdan seçilmemiş`
              : undefined
          }
          tone={reasonGaps > 0 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Günlük iade seyri"
        height={240}
        isLoading={query.isLoading}
        isEmpty={!query.isLoading && (sc?.daily.length ?? 0) === 0}
      >
        <SimpleLineChart
          data={sc?.daily ?? []}
          xKey="day"
          lines={[
            { key: "qty", label: "İade (m)" },
            { key: "count", label: "Top" },
          ]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      {sc ? (
        <>
          <BreakdownTable
            title="Müşteri Bazında"
            description="En çok iade alınan müşteriler."
            labelHeader="Müşteri"
            rows={sc.byCustomer}
            totalQty={returnQty}
            qtyHeader="İade"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde iade yok"
          />
          <BreakdownTable
            title="Neden Bazında"
            description="Kalite geri-beslemesinin ana kaynağı. Serbest metin payı yüksekse katalog eksiktir."
            labelHeader="İade nedeni"
            rows={sc.byReason}
            totalQty={returnQty}
            qtyHeader="İade"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde iade yok"
          />
          <BreakdownTable
            title="Kumaş Bazında"
            labelHeader="Kumaş"
            rows={sc.byItem}
            totalQty={returnQty}
            qtyHeader="İade"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde iade yok"
          />
          <BreakdownTable
            title="Renk Bazında"
            labelHeader="Renk"
            rows={sc.byColor}
            totalQty={returnQty}
            qtyHeader="İade"
            hasCompare={hasCompare}
            goodDirection="down"
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde iade yok"
          />
        </>
      ) : null}
    </ReportPageLayout>
  );
}
