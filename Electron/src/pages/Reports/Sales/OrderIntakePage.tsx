import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, ClipboardList, Ruler, Users } from "lucide-react";
import {
  BreakdownTable,
  ChartCard,
  DestinationSelect,
  MetricCard,
  ReportDateFilter,
  ReportExportBar,
  ReportMultiSelect,
  ReportPageLayout,
  SimpleLineChart,
} from "../_components";
import { fmtDate, fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { useReportDateRange } from "../_hooks/useReportDateRange";
import { useReportCompare } from "../_hooks/useReportCompare";
import { useReportAxes } from "../_hooks/useReportAxes";
import { filterNotes, droppedNote, labelsOf } from "../_hooks/reportAxisFilters";
import { buildOrderIntakeExport, orderIntakeApi, type OrderIntake } from "./orderIntake";

/** "Önceki dönem X · ▲ Y" ipucu — yön renkle DEĞİL işaretle de anlatılır. */
function hint(now?: number, prev?: number, unit = ""): string | undefined {
  if (now === undefined || prev === undefined) return undefined;
  const d = Math.round((now - prev) * 10) / 10;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "±";
  return `Önceki dönem ${fmtNum(prev)}${unit} · ${arrow} ${fmtNum(Math.abs(d))}${unit}`;
}

export function OrderIntakePage() {
  const { params, dateFrom, dateTo } = useReportDateRange("sales/order-intake");
  const compare = useReportCompare();
  // EKSEN SÜZGEÇLERİ (R5b-c): seçenekler yanıtın kendisinden gelir ve süzgeçten
  // BAĞIMSIZDIR (sunucu tam listeyi döner) ⇒ ikinci bir "süzgeçsiz" sorgu YOK.
  const axes = useReportAxes();

  const query = useQuery({
    queryKey: ["reports", "sales", "order-intake", params, compare.params, axes.params],
    queryFn: () => orderIntakeApi.get({ ...params, ...compare.params, ...axes.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const oi: OrderIntake | undefined = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const secenekler = query.data?.meta?.secenekler;
  const suzgec = query.data?.suzgec;
  // Süzgeç satırları ÇIKTIYA da girer (K10): dosya tek başına paylaşılıyor.
  // `destination` niteleyicisi burada da yazılı — "İhracat" başlıklı bir tablo,
  // ihracat SEVKLERİ sanılırsa rapor sessizce yanlış okunur.
  const suzgecNotlari = useMemo(() => {
    const n = filterNotes([
      { eksen: "Müşteri", degerler: labelsOf(secenekler?.customerId, axes.sel.customerId) },
      { eksen: "Kumaş", degerler: labelsOf(secenekler?.itemId, axes.sel.itemId) },
      {
        eksen: "Sevk hedefi",
        degerler: axes.sel.destination ? [axes.sel.destination === "EXPORT" ? "İhracat" : "Yurtiçi"] : [],
        serh: "Müşteri kartındaki VARSAYILAN hedef — sevkin fiili hedefi değil.",
      },
    ]);
    const d = droppedNote(suzgec?.dusenSatir);
    return d ? [...n, d] : n;
  }, [secenekler, axes.sel, suzgec]);
  const spec = useMemo(
    () => () => (oi ? buildOrderIntakeExport({ oi, periodLabel, compareLabel, filterNotes: suzgecNotlari }) : null),
    [oi, periodLabel, compareLabel, suzgecNotlari],
  );
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="sales/order-intake" showCompare bare />
      <ReportMultiSelect id="oi-musteri" label="Müşteri" options={secenekler?.customerId} value={axes.sel.customerId} onChange={(v) => axes.set("customerId", v)} emptyHint="Pencerede müşteri yok" />
      <ReportMultiSelect id="oi-kumas" label="Kumaş" options={secenekler?.itemId} value={axes.sel.itemId} onChange={(v) => axes.set("itemId", v)} emptyHint="Pencerede kumaş yok" />
      <DestinationSelect id="oi-hedef" value={axes.sel.destination} onChange={axes.setDestination} />
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="sales/order-intake"
      title="Sipariş Karnesi"
      description="Dönemde ne kadar iş geldi — adet, metraj, ortalama sipariş büyüklüğü ve iptal oranı."
      showCompare
      filters={filters}
      actions={<ReportExportBar disabled={!oi} buildSpec={spec} />}
    >
      {suzgecNotlari.length > 0 ? (
        <ul className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {suzgecNotlari.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {/* İki paydanın farkı EKRANDA yazılı olmalı: aksi halde "78 sipariş ama
          62.990 m" satırını okuyan kişi ikisini böler ve yanlış ortalamayı
          kendisi hesaplar. */}
      <p className="text-xs text-muted-foreground">
        Adet dönemde açılan <strong>tüm</strong> siparişleri sayar (sonradan iptal edilenler dahil);
        metraj iptalleri dışlar. Çıpa, siparişin <strong>alındığı</strong> tarihtir — kaydın sisteme
        yazıldığı an değil.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Alınan sipariş"
          value={fmtInt(oi?.summary.orderCount)}
          hint={hint(oi?.summary.orderCount, oi?.summary.prevOrderCount)}
          icon={ClipboardList}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="İstenen metraj"
          value={`${fmtNum(oi?.summary.totalQty)} m`}
          hint={hint(oi?.summary.totalQty, oi?.summary.prevTotalQty, " m") ?? "İptaller hariç"}
          icon={Ruler}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Ortalama sipariş"
          value={`${fmtNum(oi?.summary.avgOrderQty)} m`}
          hint={
            oi
              ? `${fmtInt(oi.summary.activeOrderCount)} iptalsiz sipariş · ${fmtNum(oi.summary.avgLinesPerOrder)} kalem/sipariş`
              : undefined
          }
          icon={Ruler}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="İptal oranı"
          value={fmtPercent(oi?.summary.cancelledPct)}
          hint={oi ? `${fmtInt(oi.summary.cancelledCount)} / ${fmtInt(oi.summary.orderCount)} sipariş` : undefined}
          icon={Ban}
          tone={
            oi === undefined ? "neutral" : oi.summary.cancelledPct >= 15 ? "bad" : oi.summary.cancelledPct >= 5 ? "warn" : "ok"
          }
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Sipariş veren müşteri"
          value={fmtInt(oi?.summary.customerCount)}
          hint={oi ? `${fmtInt(oi.summary.withDeadlineCount)} siparişte termin var` : undefined}
          icon={Users}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Günlük sipariş girişi"
        description="Gün sınırı fabrika takvimine göre kesilir. Yalnız sipariş alınan günler çizilir."
        isEmpty={!oi || oi.daily.length === 0}
        isLoading={query.isLoading}
      >
        <SimpleLineChart
          data={oi?.daily ?? []}
          xKey="day"
          // Adet SAĞ eksende: metraj binlerle, adet birlerle ölçülür — tek
          // eksende adet çizgisi dibe yapışıp görünmez oluyordu (ölçüldü).
          lines={[
            { key: "qty", label: "Metraj (m)" },
            { key: "orderCount", label: "Sipariş", axis: "right" },
          ]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      <BreakdownTable
        title="Müşteri kırılımı"
        description="Sayaç SİPARİŞ adedidir — çok kalemli sipariş müşteriyi bir kez sayar."
        labelHeader="Müşteri"
        countHeader="Sipariş"
        rows={oi?.byCustomer ?? []}
        totalQty={oi?.summary.totalQty}
        hasCompare={hasCompare}
        isLoading={query.isLoading}
      />

      <BreakdownTable
        title="Kumaş kırılımı"
        description="Sayaç KALEM adedidir — aynı sipariş birden fazla kumaş içerebilir."
        labelHeader="Kumaş"
        countHeader="Kalem"
        rows={oi?.byItem ?? []}
        totalQty={oi?.summary.totalQty}
        hasCompare={hasCompare}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
