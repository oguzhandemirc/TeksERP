import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Layers, Palette, Ruler, ShieldAlert } from "lucide-react";
import {
  BreakdownTable,
  ChartCard,
  DetailTable,
  MetricCard,
  ReportExportBar,
  ReportPageLayout,
  SimpleLineChart,
} from "../_components";
import type { BreakdownRow } from "../_components/BreakdownTable";
import { fmtDate, fmtInt, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import {
  qualityReportsApi,
  type PlanDeviationBreakdownRow,
  type PlanDeviationDetailRow,
} from "./service";
import { buildPlanDeviationExport } from "./planDeviationExport";

// =============================================================================
// PLAN-SAPMA KARNESİ — "plan dışı onayla depoya inen mal"
// =============================================================================
// Tamburda topun rengi/eni iş emri hedefinden saptığında operatöre sorulur;
// "yine de bitir" denirse mal olduğu gibi depoya iner ve karar bir İMZAdır.
//
// ⚠️ İKİ SAYIM, İKİ AD — ekranda bilinçli olarak ayrı adlandırılır:
//   • ONAY (imza) → renk+en birlikte sapan top BİR onaydır; metraj da bir kez
//     sayılır. Başlık ve kırılımlar bunu kullanır.
//   • OLAY        → alan bazlı sayaç; aynı imzada renk ve en ayrı ayrı olaydır.
// Aynı ekranda iki farklı sayı gören kullanıcı hangisinin ne olduğunu tahmin
// etmek zorunda kalmasın diye etiketler ve ipuçları bunu açıkça yazar.

function hint(now: number | undefined, prev: number | undefined, unit: string): string | undefined {
  if (prev === undefined || now === undefined) return undefined;
  const d = Math.round((now - prev) * 10) / 10;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  return `Önceki dönem ${fmtNum(prev)}${unit} · ${arrow} ${fmtNum(Math.abs(d))}${unit}`;
}

/** Karne satırını ortak `BreakdownTable` sözleşmesine çevirir (count = onay). */
function toBreakdownRows(rows: PlanDeviationBreakdownRow[]): BreakdownRow[] {
  return rows.map((r) => ({ key: r.key, label: r.label, count: r.confirmations, qty: r.qtyM }));
}

const FIELD_LABEL: Record<string, string> = { color: "Renk", width: "En" };
const SOURCE_LABEL: Record<string, string> = {
  cut: "Kesim",
  finalize: "Kart bitirme",
  "finalize-open-fabric": "Kalan bitirme",
};

const detailColumns: ColumnDef<PlanDeviationDetailRow, unknown>[] = [
  {
    accessorKey: "createdAt",
    header: "Tarih",
    cell: ({ getValue }) => (
      <span className="whitespace-nowrap tabular-nums text-muted-foreground">
        {new Date(getValue() as string).toLocaleString("tr-TR")}
      </span>
    ),
  },
  {
    accessorKey: "rollBarcode",
    header: "Top",
    cell: ({ row }) => (
      <div className="font-mono text-xs">
        {row.original.rollBarcode ?? "—"}
        {row.original.childBarcode ? (
          <span className="text-muted-foreground"> → {row.original.childBarcode}</span>
        ) : null}
      </div>
    ),
  },
  { accessorKey: "workOrderNumber", header: "İş Emri" },
  {
    accessorKey: "field",
    header: "Alan",
    cell: ({ getValue }) => FIELD_LABEL[getValue() as string] ?? (getValue() as string),
  },
  {
    id: "değişim",
    header: "Top → Plan",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        <span className="font-medium">{row.original.rollValue ?? "—"}</span>
        <span className="text-muted-foreground"> → {row.original.planValue ?? "—"}</span>
      </span>
    ),
  },
  {
    accessorKey: "qtyM",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "source",
    header: "Yol",
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">
        {SOURCE_LABEL[getValue() as string] ?? (getValue() as string)}
      </span>
    ),
  },
  {
    accessorKey: "confirmedBy",
    header: "Onaylayan",
    cell: ({ getValue }) => (getValue() as string | null) ?? "—",
  },
];

export function PlanDeviationScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("quality/plan-deviation-scorecard");
  const compare = useReportCompare();

  const query = useQuery({
    queryKey: ["reports", "quality", "plan-deviation-scorecard", params, compare.params],
    queryFn: () => qualityReportsApi.planDeviationScorecard({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const spec = useMemo(
    () => () => (sc ? buildPlanDeviationExport({ sc, periodLabel, compareLabel }) : null),
    [sc, periodLabel, compareLabel],
  );

  const totalQty = sc?.summary.deviatedQtyM ?? 0;

  return (
    <ReportPageLayout
      reportKey="quality/plan-deviation-scorecard"
      title="Plan-Sapma Karnesi"
      description="Tamburda rengi/eni iş emri hedefinden farklı olduğu hâlde operatör onayıyla depoya inen mal. Sayı büyüyorsa sorun çoğu zaman tamburda değil, iş emrinin açılışındadır."
      showCompare
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Plan dışı onay"
          value={fmtInt(sc?.summary.confirmations)}
          hint={
            hint(sc?.summary.confirmations, sc?.previous?.confirmations, "") ??
            "Operatörün imzaladığı karar sayısı"
          }
          icon={ShieldAlert}
          tone={sc === undefined ? "neutral" : sc.summary.confirmations === 0 ? "ok" : "warn"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Plan dışı metraj"
          value={`${fmtNum(totalQty)} m`}
          hint={
            hint(sc?.summary.deviatedQtyM, sc?.previous?.deviatedQtyM, " m") ??
            "Renk+en birlikte sapsa da bir kez sayılır"
          }
          icon={Layers}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Renk sapması"
          value={fmtInt(sc?.summary.byField.color.events)}
          // "Olay" sayacı: aynı onayda renk ve en ayrı ayrı sayılır — ipucu bunu
          // söylemezse kullanıcı üstteki onay sayısıyla toplamaya çalışır.
          hint={`${fmtNum(sc?.summary.byField.color.qtyM)} m · olay sayısı`}
          icon={Palette}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="En sapması"
          value={fmtInt(sc?.summary.byField.width.events)}
          hint={`${fmtNum(sc?.summary.byField.width.qtyM)} m · olay sayısı`}
          icon={Ruler}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Günlük seyir"
        height={240}
        isLoading={query.isLoading}
        isEmpty={!query.isLoading && (sc?.daily.length ?? 0) === 0}
      >
        <SimpleLineChart
          data={sc?.daily ?? []}
          xKey="day"
          lines={[
            { key: "qtyM", label: "Plan dışı (m)" },
            { key: "confirmations", label: "Onay" },
          ]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      {sc ? (
        <>
          <BreakdownTable
            title="Onaylayan Bazında"
            description="Kararı kim imzaladı. Sayı bir performans ölçüsü değildir — plan dışı malın hangi vardiyada yoğunlaştığını gösterir."
            labelHeader="Operatör"
            countHeader="Onay"
            qtyHeader="Plan dışı"
            rows={toBreakdownRows(sc.byOperator)}
            totalQty={totalQty}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde plan dışı onay yok"
          />
          <BreakdownTable
            title="Kumaş + Renk Bazında"
            description="Hangi mal plan dışı kabul edildi. Aynı kumaş+renk tekrar ediyorsa iş emri açılışındaki hedef gözden geçirilmeli."
            labelHeader="Kumaş · Renk"
            countHeader="Onay"
            qtyHeader="Plan dışı"
            rows={toBreakdownRows(sc.byItemColor)}
            totalQty={totalQty}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde plan dışı onay yok"
          />
          <DetailTable
            title="Kararlar"
            description="En yeni 200 kayıt. Aynı topta renk ve en birlikte saptıysa iki satır görünür — bu TEK onaydır, üstteki metraj bir kez sayar."
            data={sc.detail}
            columns={detailColumns}
            isLoading={query.isLoading}
            emptyLabel="Bu dönemde plan dışı onay yok"
          />
        </>
      ) : null}
    </ReportPageLayout>
  );
}
