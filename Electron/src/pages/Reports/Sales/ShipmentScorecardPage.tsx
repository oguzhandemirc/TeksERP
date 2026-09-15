import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, ClipboardCheck, Timer, Truck } from "lucide-react";
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
import { buildShipmentExport, shipmentScorecardApi, type ShipmentScorecard } from "./shipmentScorecard";

type OverdueRow = ShipmentScorecard["overdueOpen"][number];

const overdueColumns: ColumnDef<OverdueRow, unknown>[] = [
  { accessorKey: "orderNumber", header: "Sipariş No" },
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "deadline", header: "Termin", cell: ({ getValue }) => fmtDate(getValue() as string) },
  {
    accessorKey: "daysLate",
    header: () => <div className="text-right">Gecikme</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return (
        <div className={`text-right font-medium tabular-nums ${d > 30 ? "text-destructive" : "text-warning"}`}>
          {fmtNum(d)} gün
        </div>
      );
    },
  },
  {
    id: "progress",
    header: () => <div className="text-right">Sevk / İstenen</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtNum(row.original.shippedQty)} / {fmtNum(row.original.plannedQty)} m
      </div>
    ),
  },
];

function hint(now: number | undefined, prev: number | undefined, unit: string): string | undefined {
  if (prev === undefined || now === undefined) return undefined;
  const d = Math.round((now - prev) * 10) / 10;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  return `Önceki dönem ${fmtNum(prev)}${unit} · ${arrow} ${fmtNum(Math.abs(d))}${unit}`;
}

export function ShipmentScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("sales/shipment-scorecard");
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "sales", "shipment-scorecard", params, compare.params],
    queryFn: () => shipmentScorecardApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const spec = useMemo(
    () => () => (sc ? buildShipmentExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );

  return (
    <ReportPageLayout
      reportKey="sales/shipment-scorecard"
      title="Sevk & Termin Karnesi"
      description="Dönemsel sevk hacmi ve zamanında teslim oranı — müşteri ve kumaş kırılımıyla."
      showCompare
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Sevk edilen"
          value={`${fmtNum(sc?.summary.shippedQty)} m`}
          hint={hint(sc?.summary.shippedQty, sc?.summary.prevShippedQty, " m") ?? "Brüt — iade düşülmez"}
          icon={Truck}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Zamanında teslim"
          value={fmtPercent(sc?.summary.onTimePct)}
          // Payda ekranda yazılır: "%67" tek başına kaç siparişten olduğunu
          // söylemez ve 3 siparişlik bir dönemde yanıltıcı bir kesinlik verir.
          hint={
            sc
              ? `${fmtInt(sc.summary.onTimeOrders)}/${fmtInt(sc.summary.withDeadlineOrders)} terminli sipariş` +
                (sc.summary.prevOnTimePct !== undefined ? ` · önceki %${fmtNum(sc.summary.prevOnTimePct)}` : "")
              : undefined
          }
          icon={ClipboardCheck}
          tone={
            sc === undefined || sc.summary.withDeadlineOrders === 0
              ? "neutral"
              : sc.summary.onTimePct >= 95
                ? "ok"
                : sc.summary.onTimePct >= 80
                  ? "warn"
                  : "bad"
          }
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Ortalama gecikme"
          value={sc?.summary.avgLateDays === null ? "—" : `${fmtNum(sc?.summary.avgLateDays)} gün`}
          hint="Yalnız geç kapanan siparişler"
          icon={Timer}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Terminsiz sipariş"
          value={fmtInt(sc?.summary.noDeadlineOrders)}
          // Gizlenmiş bir payda, yanlış bir paydadan daha tehlikelidir.
          hint="Termin tarihi girilmediği için orana dahil edilmedi"
          tone={sc && sc.summary.noDeadlineOrders > 0 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Günlük sevk"
        height={240}
        isLoading={query.isLoading}
        isEmpty={!query.isLoading && (sc?.daily.length ?? 0) === 0}
      >
        <SimpleLineChart
          data={sc?.daily ?? []}
          xKey="day"
          lines={[{ key: "qty", label: "Sevk (m)" }]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      {sc ? (
        <>
          <DetailTable
            title="Geciken açık siparişler"
            description="Termini geçmiş ve hâlâ açık — DÖNEM FİLTRESİNDEN BAĞIMSIZ, en eski termin üstte."
            data={sc.overdueOpen}
            columns={overdueColumns}
            isLoading={query.isLoading}
            emptyLabel="Termini geçmiş açık sipariş yok"
          />
          <BreakdownTable
            title="Müşteri Bazında Sevk"
            labelHeader="Müşteri"
            rows={sc.byCustomer}
            totalQty={sc.summary.shippedQty}
            qtyHeader="Sevk"
            hasCompare={hasCompare}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde sevkiyat yok"
          />
          <BreakdownTable
            title="Kumaş Bazında Sevk"
            labelHeader="Kumaş"
            rows={sc.byItem}
            totalQty={sc.summary.shippedQty}
            qtyHeader="Sevk"
            hasCompare={hasCompare}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde sevkiyat yok"
          />
        </>
      ) : null}
    </ReportPageLayout>
  );
}
