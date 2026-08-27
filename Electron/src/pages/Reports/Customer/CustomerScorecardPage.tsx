import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Crown, Repeat, Users } from "lucide-react";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import {
  buildCustomerScorecardExport,
  customerScorecardApi,
  type AbcClass,
  type AtRiskCustomerRow,
  type CustomerRankRow,
} from "./customerScorecard";

const ABC_TONE: Record<AbcClass, string> = {
  A: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  B: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  C: "bg-muted text-muted-foreground",
};

const rankColumns: ColumnDef<CustomerRankRow, unknown>[] = [
  {
    accessorKey: "abcClass",
    header: "Sınıf",
    cell: ({ getValue }) => {
      const c = getValue() as AbcClass;
      return (
        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${ABC_TONE[c]}`}>{c}</span>
      );
    },
  },
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "orderCount",
    header: () => <div className="text-right">Sipariş</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtInt(getValue() as number)}</div>
    ),
  },
  {
    accessorKey: "totalQty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "avgOrderQty",
    header: () => <div className="text-right">Ort. sipariş</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "cumulativePct",
    header: () => <div className="text-right">Kümülatif</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtPercent(row.original.cumulativePct)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          (pay {fmtPercent(row.original.sharePct)})
        </span>
      </div>
    ),
  },
  {
    accessorKey: "avgIntervalDays",
    header: () => <div className="text-right">Sıklık</div>,
    // "Sıklık" = ortalama kaç günde bir sipariş. TÜM GEÇMİŞTEN gelir; hesaplanamıyorsa
    // sayı UYDURULMAZ, sebebi yazılır (2 siparişten ritim çıkarmak tek gözlemdir).
    cell: ({ row }) => {
      const v = row.original.avgIntervalDays;
      if (v === null)
        return (
          <div className="text-right text-[10px] text-muted-foreground">
            geçmiş yetersiz ({fmtInt(row.original.lifetimeOrderCount)} sipariş)
          </div>
        );
      return <div className="text-right tabular-nums">{fmtNum(v)} günde bir</div>;
    },
  },
  {
    accessorKey: "daysSinceLastOrder",
    header: () => <div className="text-right">Sessiz</div>,
    cell: ({ row }) => {
      const d = row.original.daysSinceLastOrder;
      if (d === null) return <div className="text-right text-muted-foreground">—</div>;
      const interval = row.original.avgIntervalDays;
      const risky = interval !== null && d / interval >= 2;
      return (
        <div className={`text-right tabular-nums ${risky ? "font-medium text-destructive" : ""}`}>
          {fmtInt(d)} gün
        </div>
      );
    },
  },
  {
    accessorKey: "topItemName",
    header: "Favori kumaş",
    cell: ({ getValue }) => <span>{(getValue() as string | null) ?? "—"}</span>,
  },
];

const riskColumns: ColumnDef<AtRiskCustomerRow, unknown>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "lastOrderDate",
    header: "Son sipariş",
    cell: ({ getValue }) => <span>{fmtDate(getValue() as string)}</span>,
  },
  {
    accessorKey: "daysSinceLastOrder",
    header: () => <div className="text-right">Sessiz</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium tabular-nums text-destructive">
        {fmtInt(getValue() as number)} gün
      </div>
    ),
  },
  {
    accessorKey: "avgIntervalDays",
    header: () => <div className="text-right">Normal ritmi</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} günde bir</div>
    ),
  },
  {
    accessorKey: "overdueRatio",
    header: () => <div className="text-right">Kat</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-bold tabular-nums text-destructive">
        {fmtNum(getValue() as number)}×
      </div>
    ),
  },
  {
    accessorKey: "lifetimeQty",
    header: () => <div className="text-right">Toplam iş</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtNum(row.original.lifetimeQty)} m
        <span className="ml-1 text-[10px] text-muted-foreground">
          / {fmtInt(row.original.lifetimeOrderCount)} sipariş
        </span>
      </div>
    ),
  },
];

export function CustomerScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange(90);
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "customer", "scorecard", params, compare.params],
    queryFn: () => customerScorecardApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const spec = useMemo(
    () => () => (sc ? buildCustomerScorecardExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );

  return (
    <ReportPageLayout
      title="Müşteri Karnesi"
      description="En çok veren, en sık veren ve kaybolmakta olan müşteri — tek ekranda."
      // Varsayılan 90 gün: 30 günlük pencere sıklık/ABC için fazla dar kalıyor.
      defaultDays={90}
      showCompare
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      {/* İki zaman kapsamının farkı EKRANDA yazılı — aksi halde aynı satırdaki
          iki sütunun farklı dönemi anlattığı görünmez. */}
      <p className="text-xs text-muted-foreground">
        Sıralama ve metrajlar <strong>seçili döneme</strong> aittir. "Sıklık" ve "Sessiz"
        sütunları ise <strong>tüm geçmişten</strong> hesaplanır — dönem içine sıkıştırılsalardı
        30 günlük bir pencerede herkes sessiz görünürdü.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Sipariş veren müşteri"
          value={fmtInt(sc?.summary.customerCount)}
          hint={
            sc?.summary.prevCustomerCount !== undefined
              ? `Önceki dönem ${fmtInt(sc.summary.prevCustomerCount)}`
              : undefined
          }
          icon={Users}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="A sınıfı müşteri"
          value={fmtInt(sc?.summary.aClassCount)}
          hint={sc ? `Metrajın %${fmtNum(sc.summary.aClassQtyPct)}'ini taşıyor` : undefined}
          icon={Crown}
          tone="ok"
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Risk altında"
          value={fmtInt(sc?.summary.atRiskCount)}
          hint="Kendi ritminin 2 katıdır sessiz"
          icon={AlertTriangle}
          tone={sc === undefined ? "neutral" : sc.summary.atRiskCount > 0 ? "bad" : "ok"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Dönemde sessiz"
          value={fmtInt(sc?.summary.dormantCount)}
          hint="Geçmişte sipariş verdi, bu dönemde vermedi"
          icon={Repeat}
          isLoading={query.isLoading}
        />
      </div>

      {sc && sc.summary.insufficientHistoryCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{fmtInt(sc.summary.insufficientHistoryCount)} müşterinin</strong> sipariş
            geçmişi ritim hesaplamak için yetersiz (3'ten az sipariş). Risk listesine{" "}
            <strong>girmediler</strong> — riskli olmadıkları için değil, ölçülemedikleri için.
            Bu sayı azaldıkça risk listesi güvenilirleşir.
          </span>
        </div>
      ) : null}

      <DetailTable<AtRiskCustomerRow>
        title="Kaybolan müşteri riski"
        description="Kendi sipariş ritminin en az 2 katı kadar sessiz kalmış müşteriler. Dönemden bağımsızdır."
        data={sc?.atRisk ?? []}
        columns={riskColumns}
        isLoading={query.isLoading}
        emptyLabel="Ritmine göre gecikmiş müşteri yok."
      />

      <DetailTable<CustomerRankRow>
        title="Müşteri sıralaması (ABC)"
        description="Metraja göre sıralı. Kümülatif pay %80'e ulaşana kadar A, %95'e kadar B, gerisi C."
        data={sc?.ranking ?? []}
        columns={rankColumns}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
