// =============================================================================
// LEVENT SONUCU — leventten beklenen kumaş (take-up) ↔ gerçek kumaş (otomatik/elle) ↔ fire
// =============================================================================
// Take-up girilmemiş çözgü kartında beklenen/fire "ölçülemedi"dir (oranın dışında, sayılır).
// Fire yalnız kapanmış (bitmiş/hurda) leventte; açık leventler pencereden bağımsız KESİT.
// =============================================================================
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtInt, fmtMeters } from "../_components/formatters";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { useFactoryRange } from "./DokumaShared";
import { formatPct } from "./dokuma-regime";
import { optionLabel } from "./dokumaFilters";
import { openBeamColumns, closedBeamColumns } from "./leventColumns";
import { buildLeventSonucuExport } from "./leventExport";
import { secenekOptions, type BeamResultReport, type BeamResultRow } from "./leventReportTypes";
import { KumasKaynakStrip, HorizonLine, useUrlFilter } from "./leventShared";
import { dokumaReportsApi } from "./service";

/** Sunucu beyanları (düzeltilmiş top · kumaşsız tüketim) + seçili süzgeçler — ekranda ve çıktıda aynı. */
function notlar(rapor: BeamResultReport | undefined, cozgu: string | null, tezgah: string | null): string[] {
  const out: string[] = [];
  if (cozgu) out.push(`Çözgü kartı: ${cozgu}`);
  if (tezgah) out.push(`Tezgah: ${tezgah}`);
  if (rapor && rapor.meta.duzeltilmisTop > 0) out.push(`${rapor.meta.duzeltilmisTop} topun metresi tüketimden sonra düzeltildi — gerçek kumaş tüketim anındaki metredir.`);
  if (rapor && rapor.meta.kumasiOlculmeyenTuketim > 0) out.push(`${rapor.meta.kumasiOlculmeyenTuketim} tüketim satırı kumaş metresi girilmeden yazıldı — fire içinde kalır.`);
  return out;
}

export function LeventSonucuPage() {
  const range = useFactoryRange("dokuma/levent-sonucu");
  const [warpSpecId, setWarpSpec] = useUrlFilter("warpSpec");
  const [machineId, setMachine] = useUrlFilter("machine");
  const q = useQuery({
    queryKey: ["reports", "dokuma", "levent-sonucu", range.from, range.to, warpSpecId, machineId],
    queryFn: () => dokumaReportsApi.leventSonucu({ from: range.from, to: range.to, warpSpecId, machineId }),
    enabled: range.ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rapor = q.data?.data;
  const cozguOptions = useMemo(() => secenekOptions(rapor?.meta.secenekler.warpSpecId), [rapor]);
  const tezgahOptions = useMemo(() => secenekOptions(rapor?.meta.secenekler.machineId), [rapor]);
  const filterNotes = useMemo(() => notlar(rapor, optionLabel(cozguOptions, warpSpecId), optionLabel(tezgahOptions, machineId)), [rapor, cozguOptions, tezgahOptions, warpSpecId, machineId]);
  const periodLabel = `${range.from} – ${range.to} (fabrika günü, levent kapanışı)`;
  const spec = useMemo(() => () => (rapor ? buildLeventSonucuExport({ rapor, periodLabel, filterNotes }) : null), [rapor, periodLabel, filterNotes]);
  const o = rapor?.ozet;
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="dokuma/levent-sonucu" bare />
      <DokumaFilterBar id="levent-sonucu-cozgu" label="Çözgü kartı" value={warpSpecId} options={cozguOptions} onChange={setWarpSpec} />
      <DokumaFilterBar id="levent-sonucu-tezgah" label="Tezgah" value={machineId} options={tezgahOptions} onChange={setMachine} />
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/levent-sonucu"
      title="Levent Sonucu"
      description="Beklenen kumaş = sarılan × (1 − take-up). Gerçek kumaş otomatik ve elle tüketim olarak ayrı basılır; take-up yoksa beklenen ve fire 'ölçülemedi'dir."
      filters={filters}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={filterNotes} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Kapanan levent" value={o ? fmtInt(o.leventSayisi) : null} hint={o ? `${fmtInt(o.acikLeventSayisi)} açık levent ayrıca` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Beklenen kumaş" value={o ? fmtMeters(o.beklenenM) : null} hint={o ? `gerçek ${fmtMeters(o.gercekM)} · sarılan ${fmtMeters(o.sarilanM)}` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Fire" value={o ? fmtMeters(o.fireM) : null} hint={o ? `${formatPct(o.firePct)} (beklenene göre)` : undefined} tone={o && (o.firePct ?? 0) > 0 ? "warn" : "neutral"} isLoading={q.isLoading} />
        <MetricCard label="Ölçülemedi" value={o ? fmtInt(o.olculemedi) : null} hint="take-up girilmemiş çözgü kartı — oranın dışında" tone={o && o.olculemedi > 0 ? "warn" : "neutral"} isLoading={q.isLoading} />
      </div>
      <KumasKaynakStrip kaynak={o?.gercekKaynak} baslik="Gerçek kumaş kaynağı" />
      <DetailTable<BeamResultRow> title="Kapanan leventler" data={rapor?.kapananlar ?? []} columns={closedBeamColumns} isLoading={q.isLoading} emptyLabel="Bu dönemde kapanan levent yok." />
      <DetailTable<BeamResultRow> title="Açık leventler (kesit)" data={rapor?.acikLeventler ?? []} columns={openBeamColumns} isLoading={q.isLoading} emptyLabel="Açık levent yok." />
      <HorizonLine meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
