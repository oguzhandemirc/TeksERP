import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Ban, CalendarX, Truck } from "lucide-react";
import { ChartCard, DestinationSelect, DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportMultiSelect, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportAxes } from "../_hooks/useReportAxes";
import { filterNotes, droppedNote, labelsOf } from "../_hooks/reportAxisFilters";
import {
  buildCancellationExport,
  orderCancellationApi,
  NO_REASON_KEY,
  type CancellationCustomerRow,
  type CancellationDetailRow,
  type CancellationReasonRow,
} from "./orderCancellation";

const reasonColumns: ColumnDef<CancellationReasonRow, unknown>[] = [
  {
    accessorKey: "label",
    header: "Sebep",
    // Kodsuz kova SOLUK basılır: bir veri boşluğudur, bir sebep değil.
    cell: ({ row }) => (
      <span className={row.original.code === NO_REASON_KEY ? "text-muted-foreground italic" : ""}>
        {row.original.label}
      </span>
    ),
  },
  {
    accessorKey: "count",
    header: () => <div className="text-right">Adet</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium tabular-nums">
        {fmtInt(row.original.count)}
        <span className="ml-1 text-[10px] text-muted-foreground">
          ({fmtPercent(row.original.sharePct)})
        </span>
      </div>
    ),
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
];

const customerColumns: ColumnDef<CancellationCustomerRow, unknown>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "count",
    header: () => <div className="text-right">İptal</div>,
    cell: ({ getValue }) => (
      <div className="text-right font-medium tabular-nums">{fmtInt(getValue() as number)}</div>
    ),
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => (
      <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>
    ),
  },
  {
    accessorKey: "cancelRatePct",
    header: () => <div className="text-right">İptal oranı</div>,
    cell: ({ getValue }) => {
      const p = getValue() as number | null;
      if (p === null) return <div className="text-right text-muted-foreground">—</div>;
      return (
        <div className={`text-right tabular-nums ${p >= 20 ? "font-medium text-destructive" : ""}`}>
          {fmtPercent(p)}
        </div>
      );
    },
  },
  {
    accessorKey: "topReasonLabel",
    header: "En sık sebep",
    cell: ({ getValue }) => <span>{(getValue() as string | null) ?? "—"}</span>,
  },
];

const orderColumns: ColumnDef<CancellationDetailRow, unknown>[] = [
  { accessorKey: "orderNumber", header: "Sipariş" },
  { accessorKey: "customerName", header: "Müşteri" },
  {
    accessorKey: "cancelledAt",
    header: "İptal tarihi",
    cell: ({ getValue }) => <span>{fmtDate(getValue() as string)}</span>,
  },
  {
    accessorKey: "daysToCancel",
    header: () => <div className="text-right">Kaç gün sonra</div>,
    // Geç iptal pahalıdır — 30 günü aşanlar işaretlenir.
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return (
        <div className={`text-right tabular-nums ${d > 30 ? "font-medium text-destructive" : ""}`}>
          {fmtNum(d)} gün
        </div>
      );
    },
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ row }) => (
      <div className="text-right tabular-nums">
        {fmtNum(row.original.qty)} m
        {row.original.shippedQty > 0 ? (
          <span className="ml-1 text-[10px] text-destructive">
            ({fmtNum(row.original.shippedQty)} m sevk edilmişti)
          </span>
        ) : null}
      </div>
    ),
  },
  {
    accessorKey: "reasonLabel",
    header: "Sebep",
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v ? <span>{v}</span> : <span className="text-muted-foreground italic">girilmemiş</span>;
    },
  },
];

export function OrderCancellationPage() {
  const { params, dateFrom, dateTo } = useReportDateRange("sales/order-cancellation");

  const axes = useReportAxes();
  const query = useQuery({
    queryKey: ["reports", "sales", "order-cancellation", params, axes.params],
    queryFn: () => orderCancellationApi.get({ ...params, ...axes.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const oc = query.data?.data;
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const secenekler = query.data?.meta?.secenekler;
  const suzgec = query.data?.suzgec;
  // ⚠️ `reasonCode` YALNIZ PAYI süzer: payda (dönemde AÇILAN siparişler)
  // süzülmez ⇒ oran "bu sebeple iptal ÷ açılan"dır. Cümle hem ekranda hem
  // ÇIKTIDA durur; olmazsa okuyucu oranı yanlış hesaplanmış sanır.
  const suzgecNotlari = useMemo(() => {
    const n = filterNotes([
      { eksen: "Müşteri", degerler: labelsOf(secenekler?.customerId, axes.sel.customerId) },
      {
        eksen: "İptal sebebi",
        degerler: labelsOf(secenekler?.reasonCode, axes.sel.reasonCode),
        serh: "Yalnız PAYI süzer: payda (dönemde açılan siparişler) süzülmez ⇒ oran 'bu sebeple iptal ÷ açılan'.",
      },
      {
        eksen: "Sevk hedefi",
        degerler: axes.sel.destination ? [axes.sel.destination === "EXPORT" ? "İhracat" : "Yurtiçi"] : [],
        serh: "Müşteri kartındaki VARSAYILAN hedef — sevkin fiili hedefi değil. Payı da paydayı da süzer.",
      },
    ]);
    const d = droppedNote(suzgec?.dusenSatir);
    return d ? [...n, d] : n;
  }, [secenekler, axes.sel, suzgec]);
  const spec = useMemo(
    () => () => (oc ? buildCancellationExport({ oc, periodLabel, filterNotes: suzgecNotlari }) : null),
    [oc, periodLabel, suzgecNotlari],
  );
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="sales/order-cancellation" bare />
      <ReportMultiSelect id="oc-musteri" label="Müşteri" options={secenekler?.customerId} value={axes.sel.customerId} onChange={(v) => axes.set("customerId", v)} emptyHint="Pencerede müşteri yok" />
      <ReportMultiSelect id="oc-sebep" label="İptal sebebi" options={secenekler?.reasonCode} value={axes.sel.reasonCode} onChange={(v) => axes.set("reasonCode", v)} emptyHint="Pencerede sebep yok" />
      <DestinationSelect id="oc-hedef" value={axes.sel.destination} onChange={axes.setDestination} />
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="sales/order-cancellation"
      title="Sipariş İptal Karnesi"
      description="Müşteriler neden vazgeçiyor, ne kadar geç vazgeçiyor ve bu kime ne kadara mal oluyor."
      filters={filters}
      actions={<ReportExportBar disabled={!oc} buildSpec={spec} />}
    >
      {suzgecNotlari.length > 0 ? (
        <ul className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {suzgecNotlari.map((n, idx) => (
            <li key={idx}>{n}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Çıpa <strong>iptalin olduğu tarihtir</strong>. Sipariş Karnesi'ndeki iptal oranı başka bir
        soruyu cevaplar ("bu dönemde <em>alınan</em> siparişlerin kaçı sonradan iptal oldu") — iki
        rakamın birbirini tutması gerekmez, ikisi de doğrudur.
      </p>

      {oc && oc.summary.reasonFillPct < 60 && oc.summary.cancelledCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            İptallerin yalnız <strong>%{fmtNum(oc.summary.reasonFillPct)}'inde</strong> sebep kodu
            var. Bu oran düşükken aşağıdaki dağılım gerçeği temsil etmez — "en sık sebep" aslında
            "sebebi yazılmış olanların en sık olanı" demektir. Sebep alanı isteğe bağlıdır;
            doluluk arttıkça rapor güvenilirleşir.
          </span>
        </div>
      ) : null}

      {oc && oc.summary.undatedCancelCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-muted-foreground/30 bg-muted/40 px-3 py-2 text-xs">
          <CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            <strong>{fmtInt(oc.summary.undatedCancelCount)} eski iptalde</strong> tarih damgası yok
            (alan 2026-08-26'da eklendi) — hiçbir döneme yazılamadıkları için bu rapora girmiyorlar.
            Geriye dönük damga <strong>uydurulmadı</strong>.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="İptal edilen sipariş"
          value={fmtInt(oc?.summary.cancelledCount)}
          hint={oc ? `${fmtNum(oc.summary.cancelledQty)} m` : undefined}
          icon={Ban}
          tone={oc === undefined ? "neutral" : oc.summary.cancelledCount > 0 ? "warn" : "ok"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="İptal oranı"
          value={oc?.summary.cancelRatePct === null ? "—" : fmtPercent(oc?.summary.cancelRatePct)}
          hint={oc ? `Dönemde açılan ${fmtInt(oc.summary.openedInPeriod)} siparişe göre` : undefined}
          icon={Ban}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Ortalama iptal gecikmesi"
          value={
            oc?.summary.medianDaysToCancel === null || oc === undefined
              ? "—"
              : `${fmtNum(oc.summary.medianDaysToCancel)} gün`
          }
          hint="Sipariş alındıktan iptale kadar (medyan)"
          icon={CalendarX}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Sevk sonrası iptal"
          value={fmtInt(oc?.summary.afterShipmentCount)}
          hint={oc ? `${fmtNum(oc.summary.afterShipmentQty)} m — en pahalı sınıf` : undefined}
          icon={Truck}
          tone={oc === undefined ? "neutral" : oc.summary.afterShipmentCount > 0 ? "bad" : "ok"}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Günlük iptal"
        isEmpty={!oc || oc.daily.length === 0}
        isLoading={query.isLoading}
      >
        <SimpleBarChart
          data={oc?.daily ?? []}
          xKey="day"
          bars={[{ key: "count", label: "İptal" }]}
          formatValue={(v) => fmtInt(v)}
        />
      </ChartCard>

      <DetailTable<CancellationReasonRow>
        title="Sebep dağılımı"
        description="Sebebi girilmemiş ve serbest metinle girilmiş iptaller ayrı satırda — gizlenmezler."
        data={oc?.byReason ?? []}
        columns={reasonColumns}
        isLoading={query.isLoading}
        emptyLabel="Bu dönemde iptal yok."
      />

      <DetailTable<CancellationCustomerRow>
        title="Müşteri kırılımı"
        description="İptal oranının paydası: o müşterinin dönemde açtığı sipariş sayısı."
        data={oc?.byCustomer ?? []}
        columns={customerColumns}
        isLoading={query.isLoading}
      />

      <DetailTable<CancellationDetailRow>
        title="İptaller"
        description="En geç iptal edilenler üstte — geç iptal pahalıdır."
        data={oc?.orders ?? []}
        columns={orderColumns}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
