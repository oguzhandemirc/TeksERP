import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Hourglass, Layers, PauseCircle, Timer } from "lucide-react";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt, fmtNum, fmtDate } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { buildWipExport, wipScorecardApi, type WipScorecard, type WipStationRow } from "./wipScorecard";

const ageTone = (d: number | null) => (d === null ? "" : d > 7 ? "text-destructive" : d > 3 ? "text-warning" : "");

const stationColumns: ColumnDef<WipStationRow, unknown>[] = [
  { accessorKey: "label", header: "İstasyon" },
  {
    accessorKey: "waitingQty",
    header: () => <div className="text-right">Bekleyen</div>,
    cell: ({ row }) =>
      row.original.waitingCount === 0 ? (
        <div className="text-right text-muted-foreground">boş</div>
      ) : (
        <div className="text-right font-medium tabular-nums">
          {fmtNum(row.original.waitingQty)} m
          <div className="text-[10px] font-normal text-muted-foreground">
            {fmtInt(row.original.waitingCount)} top
          </div>
        </div>
      ),
  },
  {
    accessorKey: "oldestDays",
    header: () => <div className="text-right">En eski</div>,
    cell: ({ row }) =>
      row.original.oldestDays === null ? (
        <div className="text-right text-muted-foreground">—</div>
      ) : (
        <div className={`text-right tabular-nums ${ageTone(row.original.oldestDays)}`}>
          {fmtNum(row.original.oldestDays)} gün
        </div>
      ),
  },
  {
    accessorKey: "avgWaitDays",
    header: () => <div className="text-right">Ort. bekleme</div>,
    cell: ({ row }) =>
      row.original.avgWaitDays === null ? (
        <div className="text-right text-muted-foreground">—</div>
      ) : (
        <div className="text-right tabular-nums">{fmtNum(row.original.avgWaitDays)} gün</div>
      ),
  },
  {
    accessorKey: "passedCount",
    header: () => <div className="text-right">Dönemde geçen</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums text-muted-foreground">
        {fmtInt(row.original.passedCount)}
      </div>
    ),
  },
  {
    accessorKey: "avgDurationHours",
    header: () => <div className="text-right">Ort. süre</div>,
    cell: ({ row }) =>
      row.original.avgDurationHours === null ? (
        <div className="text-right text-muted-foreground">—</div>
      ) : (
        <div className="text-right tabular-nums text-muted-foreground">
          {fmtNum(row.original.avgDurationHours)} sa
        </div>
      ),
  },
];

const rollColumns: ColumnDef<WipScorecard["oldestWaiting"][number], unknown>[] = [
  { accessorKey: "barcode", header: "Barkod", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  {
    id: "spec",
    header: "Kumaş / Renk",
    cell: ({ row }) => (
      <span>
        {row.original.itemName}
        {row.original.colorName ? <span className="text-muted-foreground"> · {row.original.colorName}</span> : null}
      </span>
    ),
  },
  { accessorKey: "stationName", header: "İstasyon" },
  {
    accessorKey: "workOrderNumber",
    header: "İş Emri",
    cell: ({ getValue }) => (getValue() as string) ?? "—",
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>,
  },
  {
    accessorKey: "daysWaiting",
    header: () => <div className="text-right">Bekleme</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return <div className={`text-right font-medium tabular-nums ${ageTone(d)}`}>{fmtNum(d)} gün</div>;
    },
  },
];

const woColumns: ColumnDef<WipScorecard["neverStarted"][number], unknown>[] = [
  { accessorKey: "workOrderNumber", header: "İş Emri" },
  { accessorKey: "status", header: "Durum" },
  {
    accessorKey: "daysOpen",
    header: () => <div className="text-right">Açık</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return <div className={`text-right tabular-nums ${ageTone(d)}`}>{fmtNum(d)} gün</div>;
    },
  },
];

export function WipScorecardPage() {
  const { params, dateFrom, dateTo } = useReportDateRange(30);

  const query = useQuery({
    queryKey: ["reports", "production", "wip", params],
    queryFn: () => wipScorecardApi.get(params),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const spec = useMemo(() => () => (sc ? buildWipExport({ sc, periodLabel }) : null), [sc, periodLabel]);

  return (
    <ReportPageLayout
      title="Nerede Takıldı (WIP)"
      description="İstasyonlarda bekleyen mal, en uzun bekleyen işler ve hiç başlamamış iş emirleri."
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      {/* İki bölümün zaman anlayışı farklı — bu satır olmadan kullanıcı bekleyen
          rakamını da seçtiği döneme ait sanır. */}
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <strong>Bekleyen</strong> sütunları <strong>anlık</strong> durumu gösterir ve tarih aralığından
        etkilenmez. <strong>Dönemde geçen</strong> ve <strong>ort. süre</strong> ise seçilen aralığa aittir.
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="İstasyonlarda bekleyen"
          value={`${fmtNum(sc?.summary.waitingQty)} m`}
          hint={sc ? `${fmtInt(sc.summary.waitingCount)} top` : undefined}
          icon={Layers}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="En uzun bekleyen"
          value={sc?.summary.oldestDays === null ? "—" : `${fmtNum(sc?.summary.oldestDays)} gün`}
          icon={Hourglass}
          tone={sc?.summary.oldestDays != null && sc.summary.oldestDays > 7 ? "bad" : sc?.summary.oldestDays != null && sc.summary.oldestDays > 3 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Ortalama bekleme"
          value={sc?.summary.avgWaitDays === null ? "—" : `${fmtNum(sc?.summary.avgWaitDays)} gün`}
          hint="Top ağırlıklı"
          icon={Timer}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Hiç başlamamış iş emri"
          value={fmtInt(sc?.summary.neverStartedWorkOrders)}
          hint={
            sc?.summary.neverStartedOldestDays != null
              ? `En eskisi ${fmtNum(sc.summary.neverStartedOldestDays)} gündür açık`
              : undefined
          }
          icon={PauseCircle}
          tone={sc && sc.summary.neverStartedWorkOrders > 0 ? "warn" : "neutral"}
          isLoading={query.isLoading}
        />
      </div>

      <DetailTable
        title="İstasyon Durumu"
        description="Bekleyen metraj büyükten küçüğe. Dönemde iş geçirmiş ama şu an boş istasyonlar da listede kalır."
        data={sc?.byStation ?? []}
        columns={stationColumns}
        isLoading={query.isLoading}
        emptyLabel="İstasyonlarda bekleyen mal yok"
      />

      <DetailTable
        title="En uzun bekleyen toplar"
        description="Doğrudan müdahale listesi — en eski 25 top."
        data={sc?.oldestWaiting ?? []}
        columns={rollColumns}
        isLoading={query.isLoading}
        emptyLabel="Bekleyen top yok"
      />

      <DetailTable
        title="Hiç başlamamış iş emirleri"
        description="Açılmış ama hiç malzeme girmemiş canlı iş emirleri — en eski 25 tanesi. Planlama backlog'u da olabilir, unutulmuş iş de."
        data={sc?.neverStarted ?? []}
        columns={woColumns}
        isLoading={query.isLoading}
        emptyLabel="Tüm canlı iş emirleri başlamış"
      />
    </ReportPageLayout>
  );
}
