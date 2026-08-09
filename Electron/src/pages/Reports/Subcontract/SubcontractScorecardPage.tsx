import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlarmClock, Clock, Scissors, Truck } from "lucide-react";
import { DeltaBadge, DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt, fmtNum, fmtPercent, fmtDate } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import {
  buildSubcontractExport,
  subcontractScorecardApi,
  type SubcontractScorecard,
  type SubcontractScorecardRow,
} from "./scorecard";

const num = (v: number | null | undefined, unit = "") => (
  <div className="text-right tabular-nums">
    {fmtNum(v)}
    {unit}
  </div>
);

function firmColumns(hasCompare: boolean): ColumnDef<SubcontractScorecardRow, unknown>[] {
  const cols: ColumnDef<SubcontractScorecardRow, unknown>[] = [
    { accessorKey: "label", header: "Fason firma" },
    {
      accessorKey: "dispatchedQty",
      header: () => <div className="text-right">Giden</div>,
      cell: ({ row }) => num(row.original.dispatchedQty, " m"),
    },
    {
      accessorKey: "returnedQty",
      header: () => <div className="text-right">Dönen</div>,
      cell: ({ row }) => num(row.original.returnedQty, " m"),
    },
    {
      accessorKey: "fireQty",
      header: () => <div className="text-right">Fire</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">{fmtNum(row.original.fireQty)} m</div>
      ),
    },
    {
      accessorKey: "firePct",
      header: () => <div className="text-right">Fire %</div>,
      cell: ({ row }) => {
        const p = row.original.firePct;
        const tone = p <= 2 ? "text-success" : p <= 5 ? "text-warning" : "text-destructive";
        return (
          <div className={`text-right font-medium tabular-nums ${tone}`}>
            {fmtPercent(p)}
            {/* Payda ekranda da yazılır: "%4" tek başına neyin yüzdesi belli değil
                ve kullanıcı onu giden metrajın yüzdesi sanar. */}
            <div className="text-[10px] font-normal text-muted-foreground">
              {fmtNum(row.original.closedDispatchedQty)} m üzerinden
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "openQty",
      header: () => <div className="text-right">Açık</div>,
      cell: ({ row }) =>
        row.original.openQty > 0 ? (
          <div className="text-right tabular-nums text-warning">
            {fmtNum(row.original.openQty)} m
            <div className="text-[10px] text-muted-foreground">{fmtInt(row.original.openItems)} kalem</div>
          </div>
        ) : (
          <div className="text-right text-muted-foreground">—</div>
        ),
    },
    {
      accessorKey: "avgTurnaroundDays",
      header: () => <div className="text-right">Süre</div>,
      cell: ({ row }) =>
        row.original.avgTurnaroundDays === null ? (
          <div className="text-right text-muted-foreground">—</div>
        ) : (
          <div className="text-right tabular-nums">{fmtNum(row.original.avgTurnaroundDays)} gün</div>
        ),
    },
  ];
  if (hasCompare) {
    cols.push({
      id: "delta",
      header: () => <div className="text-right">Δ fire</div>,
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {/* Fire artışı KÖTÜ → goodDirection="down" */}
          <DeltaBadge now={row.original.firePct} prev={row.original.prevFirePct} suffix="%" goodDirection="down" />
        </div>
      ),
    });
  }
  return cols;
}

const openColumns: ColumnDef<SubcontractScorecard["oldestOpen"][number], unknown>[] = [
  { accessorKey: "dispatchNo", header: "Sevk No" },
  { accessorKey: "subcontractorName", header: "Fason firma" },
  {
    accessorKey: "dispatchedAt",
    header: "Sevk tarihi",
    cell: ({ getValue }) => fmtDate(getValue() as string),
  },
  {
    accessorKey: "daysOpen",
    header: () => <div className="text-right">Gün</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return (
        <div className={`text-right font-medium tabular-nums ${d > 30 ? "text-destructive" : d > 14 ? "text-warning" : ""}`}>
          {fmtNum(d)}
        </div>
      );
    },
  },
  {
    accessorKey: "openQty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtNum(row.original.openQty)} m
        <div className="text-[10px] text-muted-foreground">{fmtInt(row.original.openItems)} kalem</div>
      </div>
    ),
  },
];

export function SubcontractScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange(90);
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "subcontract", "scorecard", params, compare.params],
    queryFn: () => subcontractScorecardApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const spec = useMemo(
    () => () => (sc ? buildSubcontractExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );
  const cols = useMemo(() => firmColumns(hasCompare), [hasCompare]);

  return (
    <ReportPageLayout
      title="Fason Karnesi"
      description="Giden ↔ dönen metraj (fason firesi), dönüş süresi ve açık bakiye — firma bazında."
      showCompare
      defaultDays={90}
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Fason firesi"
          value={fmtPercent(sc?.summary.firePct)}
          hint={
            sc
              ? `${fmtNum(sc.summary.fireQty)} m · kapanmış ${fmtNum(sc.summary.closedDispatchedQty)} m üzerinden`
              : undefined
          }
          icon={Scissors}
          tone={sc === undefined ? "neutral" : sc.summary.firePct <= 2 ? "ok" : sc.summary.firePct <= 5 ? "warn" : "bad"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Gönderilen"
          value={`${fmtNum(sc?.summary.dispatchedQty)} m`}
          hint={
            sc?.summary.prevDispatchedQty !== undefined
              ? `Önceki dönem ${fmtNum(sc.summary.prevDispatchedQty)} m`
              : undefined
          }
          icon={Truck}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Açık bakiye"
          value={`${fmtNum(sc?.summary.openQty)} m`}
          hint={sc ? `${fmtInt(sc.summary.openItems)} kalem hâlâ fasonda` : undefined}
          icon={AlarmClock}
          tone={sc && sc.summary.openQty > 0 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Ortalama dönüş"
          value={sc?.summary.avgTurnaroundDays === null ? "—" : `${fmtNum(sc?.summary.avgTurnaroundDays)} gün`}
          hint="Yalnız dönüşü gelmiş kalemler"
          icon={Clock}
          isLoading={query.isLoading}
        />
      </div>

      <DetailTable
        title="Firma Bazında"
        description="Fire oranı yalnız DÖNÜŞÜ GELMİŞ kalemlerden hesaplanır; açık bakiye ayrı kolonda durur."
        data={sc?.bySubcontractor ?? []}
        columns={cols}
        isLoading={query.isLoading}
        emptyLabel="Bu dönemde fason sevki yok"
      />

      <DetailTable
        title="En eski açık sevkler"
        description="Hâlâ dönmemiş sevkler — DÖNEM FİLTRESİNDEN BAĞIMSIZ, en eskiden başlayarak."
        data={sc?.oldestOpen ?? []}
        columns={openColumns}
        isLoading={query.isLoading}
        emptyLabel="Açık fason sevki yok"
      />
    </ReportPageLayout>
  );
}
