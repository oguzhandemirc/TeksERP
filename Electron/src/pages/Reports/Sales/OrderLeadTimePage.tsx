import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Clock, Hourglass, Timer } from "lucide-react";
import { DetailTable, MetricCard, ReportAxisBar, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtDate, fmtInt, fmtNum } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";
import {
  buildLeadTimeExport,
  orderLeadTimeApi,
  type LeadTimeBucketRow,
  type LeadTimeOrderRow,
  type LeadTimeStats,
} from "./orderLeadTime";

/**
 * Örneklem eşiğin altındaysa SAYI BASILMAZ. "3 gün" yazan bir kart, tek
 * siparişten hesaplandığını söylemezse termin sözü ona dayandırılır.
 */
function StatCell({ s, minSample }: { s: LeadTimeStats; minSample: number }) {
  if (s.sampleSize === 0) return <span className="text-muted-foreground">—</span>;
  if (s.sampleSize < minSample)
    return (
      <span className="text-muted-foreground">
        {fmtNum(s.medianDays)} gün
        <span className="ml-1 text-[10px]">({fmtInt(s.sampleSize)} örnek — güvenilmez)</span>
      </span>
    );
  return (
    <span className="font-medium tabular-nums">
      {fmtNum(s.medianDays)} gün
      <span className="ml-1 text-[10px] text-muted-foreground">({fmtInt(s.sampleSize)} örnek)</span>
    </span>
  );
}

const AXIS_KEYS = ["customerId", "itemId"] as const;

export function OrderLeadTimePage() {
  const { params, dateFrom, dateTo } = useReportDateRange("sales/order-leadtime");

  const axes = useReportAxes();

  const query = useQuery({
    queryKey: ["reports", "sales", "order-leadtime", params, axes.params],
    queryFn: () => orderLeadTimeApi.get({ ...params, ...axes.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const lt = query.data?.data;
  const minSample = lt?.minSample ?? 5;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const { secenekler, notes: suzgecNotlari } = useAxisNotes(query.data, axes.sel, AXIS_KEYS, { destination: true });
  const spec = useMemo(
    () => () => (lt ? buildLeadTimeExport({ lt, periodLabel, filterNotes: suzgecNotlari }) : null),
    [lt, periodLabel, suzgecNotlari],
  );

  const bucketColumns = (labelHeader: string): ColumnDef<LeadTimeBucketRow, unknown>[] => [
    { accessorKey: "label", header: labelHeader },
    {
      id: "firstShip",
      header: () => <div className="text-right">İlk sevk (medyan)</div>,
      cell: ({ row }) => (
        <div className="text-right">
          <StatCell s={row.original.firstShip} minSample={minSample} />
        </div>
      ),
    },
    {
      id: "fullClose",
      header: () => <div className="text-right">Tam kapanış (medyan)</div>,
      cell: ({ row }) => (
        <div className="text-right">
          <StatCell s={row.original.fullClose} minSample={minSample} />
        </div>
      ),
    },
    {
      id: "p90",
      header: () => <div className="text-right">Kapanış P90</div>,
      cell: ({ row }) => {
        const s = row.original.fullClose;
        return (
          <div className="text-right tabular-nums">
            {s.sampleSize >= minSample && s.p90Days !== null ? `${fmtNum(s.p90Days)} gün` : "—"}
          </div>
        );
      },
    },
  ];

  const orderColumns: ColumnDef<LeadTimeOrderRow, unknown>[] = [
    { accessorKey: "orderNumber", header: "Sipariş" },
    { accessorKey: "customerName", header: "Müşteri" },
    {
      accessorKey: "orderDate",
      header: "Sipariş tarihi",
      cell: ({ getValue }) => <span>{fmtDate(getValue() as string)}</span>,
    },
    {
      accessorKey: "firstShipDays",
      header: () => <div className="text-right">İlk sevk</div>,
      cell: ({ row }) => {
        const d = row.original.firstShipDays;
        return (
          <div className="text-right tabular-nums">
            {d === null ? <span className="text-muted-foreground">sevk yok</span> : `${fmtNum(d)} gün`}
          </div>
        );
      },
    },
    {
      accessorKey: "fullCloseDays",
      header: () => <div className="text-right">Kapanış</div>,
      cell: ({ row }) => {
        const d = row.original.fullCloseDays;
        return (
          <div className="text-right tabular-nums">
            {d === null ? <span className="text-muted-foreground">açık</span> : `${fmtNum(d)} gün`}
          </div>
        );
      },
    },
    {
      accessorKey: "openDays",
      header: () => <div className="text-right">Bekleme</div>,
      cell: ({ row }) => {
        const d = row.original.openDays;
        if (d === null) return <div className="text-right text-muted-foreground">—</div>;
        return (
          <div className={`text-right font-medium tabular-nums ${d > 30 ? "text-destructive" : ""}`}>
            {fmtNum(d)} gün
          </div>
        );
      },
    },
  ];

  const thin = lt !== undefined && lt.firstShip.sampleSize < minSample;

  return (
    <ReportPageLayout
      reportKey="sales/order-leadtime"
      title="Sipariş → Teslim Süresi"
      description="Sipariş alındıktan kaç gün sonra mal çıkıyor — termin sözünün dayanağı."
      // Varsayılan 180 gün: teslim süresi ölçmek için 30 günlük pencere fazla dar
      // (siparişin kapanması bir aydan uzun sürebilir, örneklem hiç dolmaz).
      filters={<ReportAxisBar reportKey="sales/order-leadtime" axes={axes} secenekler={secenekler} eksenler={AXIS_KEYS} destination />}
      actions={<ReportExportBar disabled={!lt} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={suzgecNotlari} />
      {thin ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Bu dönemde yalnız <strong>{fmtInt(lt.firstShip.sampleSize)} sipariş</strong> sevk gördü —
            teslim süresi istatistiği için yeterli değil (eşik {minSample}).{" "}
            <strong>{fmtInt(lt.neverShippedCount)} sipariş</strong> hiç sevk görmedi. Aşağıdaki
            bekleme listesi yine de bugün işe yarar: en uzun bekleyen açık siparişler üstte.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="İlk sevke kadar (medyan)"
          value={
            lt === undefined || lt.firstShip.sampleSize < minSample
              ? "—"
              : `${fmtNum(lt.firstShip.medianDays)} gün`
          }
          hint={lt ? `${fmtInt(lt.firstShip.sampleSize)} örnek (eşik ${minSample})` : undefined}
          icon={Timer}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Tam kapanışa kadar (medyan)"
          value={
            lt === undefined || lt.fullClose.sampleSize < minSample
              ? "—"
              : `${fmtNum(lt.fullClose.medianDays)} gün`
          }
          hint={lt ? `${fmtInt(lt.fullClose.sampleSize)} örnek` : undefined}
          icon={Clock}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Taahhüt sınırı (P90)"
          value={
            lt === undefined || lt.fullClose.sampleSize < minSample
              ? "—"
              : `${fmtNum(lt.fullClose.p90Days)} gün`
          }
          hint="Her 10 siparişten 9'u bu sürede kapandı"
          icon={Hourglass}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Hiç sevk görmemiş"
          value={fmtInt(lt?.neverShippedCount)}
          hint="İstatistiğe girmez, ayrı sayılır"
          icon={AlertTriangle}
          tone={lt === undefined ? "neutral" : lt.neverShippedCount > 0 ? "warn" : "ok"}
          isLoading={query.isLoading}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Ana rakam <strong>medyandır</strong>: ortalama tek bir felaket siparişle yukarı çekilir ve
        ona dayanan termin sözü siparişlerin yarısında tutmaz. Örneklem {minSample} altındaysa sayı
        basılmaz — az örnekle hesaplanan medyan istatistik değil tesadüftür.
      </p>

      <DetailTable<LeadTimeOrderRow>
        title="Siparişler"
        description="En uzun bekleyen açık siparişler üstte."
        data={lt?.orders ?? []}
        columns={orderColumns}
        isLoading={query.isLoading}
      />

      <DetailTable<LeadTimeBucketRow>
        title="Müşteri kırılımı"
        data={lt?.byCustomer ?? []}
        columns={bucketColumns("Müşteri")}
        isLoading={query.isLoading}
      />

      <DetailTable<LeadTimeBucketRow>
        title="Kumaş kırılımı"
        description="Çok kumaşlı sipariş her kumaşa sayılır — satır toplamı sipariş sayısını aşabilir."
        data={lt?.byItem ?? []}
        columns={bucketColumns("Kumaş")}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
