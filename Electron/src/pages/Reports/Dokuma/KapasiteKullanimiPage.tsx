// =============================================================================
// KAPASİTE KULLANIMI — tezgah × fabrika haftası: teorik kapasite (nominal ÷ atkı/cm × 0,6 × takvim
// saati) ↔ gerçek top metresi. Nominal ya da atkı/cm yoksa satır "hesaplanamadı" + gerekçe; oranın
// dışında kalır ama gerçek metresi ayrıca sayılır (sessiz düşüş yok).
// =============================================================================
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtInt, fmtMeters } from "../_components/formatters";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { useFactoryRange } from "./DokumaShared";
import { formatPct } from "./dokuma-regime";
import { optionLabel } from "./dokumaFilters";
import { kapasiteColumns } from "./leventColumns";
import { buildKapasiteExport } from "./leventExport";
import { secenekOptions, type CapacityRow } from "./leventReportTypes";
import { HorizonLine, useUrlFilter } from "./leventShared";
import { dokumaReportsApi } from "./service";

export function KapasiteKullanimiPage() {
  const range = useFactoryRange("dokuma/kapasite-kullanimi");
  const [machineId, setMachine] = useUrlFilter("machine");
  const q = useQuery({
    queryKey: ["reports", "dokuma", "kapasite-kullanimi", range.from, range.to, machineId],
    queryFn: () => dokumaReportsApi.kapasiteKullanimi({ from: range.from, to: range.to, machineId }),
    enabled: range.ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rapor = q.data?.data;
  const tezgahOptions = useMemo(() => secenekOptions(rapor?.meta.secenekler.machineId), [rapor]);
  const tezgah = optionLabel(tezgahOptions, machineId);
  const filterNotes = useMemo(() => (tezgah ? [`Tezgah: ${tezgah}`] : []), [tezgah]);
  const periodLabel = `${range.from} – ${range.to} (fabrika günü, ISO hafta)`;
  const spec = useMemo(() => () => (rapor ? buildKapasiteExport({ rapor, periodLabel, filterNotes }) : null), [rapor, periodLabel, filterNotes]);
  const o = rapor?.ozet;
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="dokuma/kapasite-kullanimi" bare />
      <DokumaFilterBar id="kapasite-tezgah" label="Tezgah" value={machineId} options={tezgahOptions} onChange={setMachine} />
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/kapasite-kullanimi"
      title="Kapasite Kullanımı"
      description="Teorik m/saat = nominal atkı/dk ÷ atkı/cm × 0,6. Nominal ya da atkı/cm yoksa kullanım hesaplanmaz; gerekçesi satırda yazar."
      filters={filters}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={filterNotes} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Kullanım (Σ)" value={o ? formatPct(o.kullanimPct) : null} hint="Σ gerçek / Σ potansiyel (hesaplanabilen satırlar)" isLoading={q.isLoading} />
        <MetricCard label="Potansiyel" value={o ? fmtMeters(o.potansiyelM) : null} hint={o ? `gerçek ${fmtMeters(o.gercekM)}` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Toplam gerçek" value={o ? fmtMeters(o.toplamGercekM) : null} hint={o ? `${fmtMeters(o.hesaplanamayanGercekM)} oranın dışında` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Hesaplanamadı" value={o ? fmtInt(o.hesaplanamadi) : null} hint={o ? `${fmtInt(o.satirSayisi)} satırdan (nominal / atkı/cm yok)` : undefined} tone={o && o.hesaplanamadi > 0 ? "warn" : "neutral"} isLoading={q.isLoading} />
      </div>
      <DetailTable<CapacityRow> title="Tezgah × hafta" data={rapor?.satirlar ?? []} columns={kapasiteColumns} isLoading={q.isLoading} emptyLabel="Bu dönemde tezgah satırı yok." />
      <HorizonLine meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
