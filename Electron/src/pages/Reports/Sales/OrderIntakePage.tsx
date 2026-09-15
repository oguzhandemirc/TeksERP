import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Ban, ClipboardList, Ruler, Users } from "lucide-react";
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

  const query = useQuery({
    queryKey: ["reports", "sales", "order-intake", params, compare.params],
    queryFn: () => orderIntakeApi.get({ ...params, ...compare.params }),
    enabled: Boolean(params.dateFrom && params.dateTo),
    staleTime: 30_000,
  });

  const oi: OrderIntake | undefined = query.data?.data;
  const cmpRange = query.data?.compareRange;
  const hasCompare = Boolean(cmpRange);
  const periodLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`;
  const compareLabel = cmpRange ? `${fmtDate(cmpRange.from)} – ${fmtDate(cmpRange.to)}` : null;

  const spec = useMemo(
    () => () => (oi ? buildOrderIntakeExport({ oi, periodLabel, compareLabel }) : null),
    [oi, periodLabel, compareLabel],
  );

  return (
    <ReportPageLayout
      reportKey="sales/order-intake"
      title="Sipariş Karnesi"
      description="Dönemde ne kadar iş geldi — adet, metraj, ortalama sipariş büyüklüğü ve iptal oranı."
      showCompare
      actions={<ReportExportBar disabled={!oi} buildSpec={spec} />}
    >
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
