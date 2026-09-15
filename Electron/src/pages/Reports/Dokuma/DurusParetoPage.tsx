// =============================================================================
// DURUŞ PARETO — SEBEP × SÜRE SINIFI; MINOR sebep DEĞİL (ayrı kutu); sınıflandırılmamış
// ve atanmamış (levent ekseni, listeyle KESİŞİR) ayrı kutular
// =============================================================================
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ChartCard, DetailTable, MetricCard, ReportExportBar, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt } from "../_components/formatters";
import { buildParetoExport } from "./dokumaExport";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { machineOptionsFrom, optionLabel, pickReportData } from "./dokumaFilters";
import { HorizonNote, SourceBreakdownStrip, fmtSec, useFactoryRange } from "./DokumaShared";
import { dokumaReportsApi, type LossClass, type ParetoReasonRow } from "./service";

const LOSS_LABELS: Record<LossClass, string> = {
  UNPLANNED: "Plansız", SETUP: "Kurulum", PLANNED: "Planlı", NON_SCHEDULED: "Çalışma dışı", MINOR: "Mikro",
};

const columns: ColumnDef<ParetoReasonRow>[] = [
  { accessorKey: "reasonLabel", header: "Sebep", cell: ({ row }) => row.original.reasonLabel ?? row.original.reasonCode },
  { accessorKey: "reasonCode", header: "Kod" },
  { accessorKey: "lossClass", header: "Süre sınıfı", cell: ({ getValue }) => { const v = getValue() as LossClass | null; return v ? LOSS_LABELS[v] : "—"; } },
  { accessorKey: "stopCount", header: "Olay", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "stopSec", header: "Süre", cell: ({ getValue }) => fmtSec(getValue() as number) },
];

export function DurusParetoPage() {
  const range = useFactoryRange(7);
  const [sp, setSp] = useSearchParams();
  const machineId = sp.get("machine") ?? "";
  // PENCERE sorgusu (süzgeçsiz): süzgeç yokken tablo buradan gelir.
  const pencere = useQuery({
    queryKey: ["reports", "dokuma", "durus-pareto", range.from, range.to],
    queryFn: () => dokumaReportsApi.pareto({ from: range.from, to: range.to }),
    enabled: range.ready,
    staleTime: 30_000,
  });
  const suzgecli = useQuery({
    queryKey: ["reports", "dokuma", "durus-pareto", range.from, range.to, machineId],
    queryFn: () => dokumaReportsApi.pareto({ from: range.from, to: range.to, machineId }),
    enabled: range.ready && machineId !== "",
    staleTime: 30_000,
  });
  // ⚠️ SEÇENEK LİSTESİ BU RAPORDAN DOĞAMAZ: Pareto satırı SEBEP eksenlidir,
  // makine taşımaz. Liste RANDIMAN penceresinden kurulur — aynı izin
  // (`report:production`), aynı pencere, AYNI QUERY ANAHTARI ⇒ Randıman
  // ziyaret edildiyse ikinci istek doğmaz; edilmediyse pencere başına bir
  // istek doğar (sunucudan makine listesi çekmek `station:read` isterdi).
  const makineKaynagi = useQuery({
    queryKey: ["reports", "dokuma", "randiman", range.from, range.to],
    queryFn: () => dokumaReportsApi.efficiency({ from: range.from, to: range.to }),
    enabled: range.ready,
    staleTime: 30_000,
  });
  const isLoading = pencere.isLoading || (machineId !== "" && suzgecli.isLoading);
  const data = pickReportData({ windowData: pencere.data, filteredData: suzgecli.data, filterId: machineId });
  const rapor = data?.data;
  const machineOptions = useMemo(() => machineOptionsFrom(makineKaynagi.data?.data.satirlar), [makineKaynagi.data]);
  const machineLabel = optionLabel(machineOptions, machineId);
  const chartRows = (rapor?.sebepler ?? []).slice(0, 10);
  const chartData = chartRows.map((r) => ({ name: r.reasonLabel ?? r.reasonCode, dk: Math.round(r.stopSec / 60) }));
  const periodLabel = `${range.from} – ${range.to} (fabrika günü)`;
  const spec = useMemo(
    () => () => (rapor ? buildParetoExport({ rapor, periodLabel, filterLabel: machineLabel }) : null),
    [rapor, periodLabel, machineLabel],
  );
  const filters = (
    <div className="flex items-end gap-3 border-b px-4 py-3">
      <DokumaFilterBar
        id="pareto-makine"
        label="Tezgah"
        value={machineId}
        options={machineOptions}
        onChange={(id) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set("machine", id); else n.delete("machine"); return n; }, { replace: true })}
      />
    </div>
  );

  return (
    <ReportPageLayout
      title="Duruş Pareto"
      description="Sebep sıralama ekseni, süre sınıfı gruplama eksenidir. Mikro duruşlar bir sebep değil bir süre sınıfıdır ve ayrı sayılır."
      defaultDays={7}
      filters={filters}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Toplam duruş" value={rapor ? fmtSec(rapor.toplam.stopSec) : null} hint={rapor ? `${fmtInt(rapor.toplam.stopCount)} olay = sebepler + mikro + sınıflandırılmamış` : undefined} isLoading={isLoading} />
        <MetricCard label="Mikro duruşlar (eşik altı)" value={rapor ? fmtSec(rapor.mikroDuruslar.stopSec) : null} hint={rapor ? `${fmtInt(rapor.mikroDuruslar.stopCount)} olay — sebep listesinde değil` : undefined} isLoading={isLoading} />
        <MetricCard label="Sınıflandırılmamış" value={rapor ? fmtSec(rapor.siniflandirilmamis.stopSec) : null} hint={rapor ? `${fmtInt(rapor.siniflandirilmamis.stopCount)} olay — sebep bekliyor, plansız sayıldı` : undefined} tone={rapor && rapor.siniflandirilmamis.stopCount > 0 ? "warn" : "neutral"} isLoading={isLoading} />
        <MetricCard label="Yuvası atanmamış" value={rapor ? fmtSec(rapor.atanmamis.stopSec) : null} hint={rapor ? `${fmtInt(rapor.atanmamis.stopCount)} olay — levent ekseni, sebep listesiyle kesişir` : undefined} isLoading={isLoading} />
      </div>
      <SourceBreakdownStrip kirilim={rapor?.kaynakKirilimi} unit="karne" />
      <ChartCard title="En uzun 10 sebep (dakika)" description="Süreye göre azalan." height={Math.max(220, chartData.length * 28 + 40)} isLoading={isLoading} isEmpty={!isLoading && chartData.length === 0}>
        <SimpleBarChart data={chartData} xKey="name" bars={[{ key: "dk", label: "Dakika" }]} formatValue={(v) => fmtInt(v)} horizontal />
      </ChartCard>
      <DetailTable<ParetoReasonRow> title="Sebep × süre sınıfı" data={rapor?.sebepler ?? []} columns={columns} isLoading={isLoading} />
      <HorizonNote meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
