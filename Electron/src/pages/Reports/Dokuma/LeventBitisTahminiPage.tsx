// =============================================================================
// LEVENT BİTİŞ TAHMİNİ — KESİT: tezgahtaki leventin kalanı ÷ son 7 fabrika günü ortalama tüketim.
// Tüketim yoksa tahmin "hesaplanamadı" + gerekçe; gün uydurulmaz. Tarih süzgeci YOK (katalog `tarih: "yok"`).
// =============================================================================
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { DetailTable, MetricCard, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtCalendarDate, fmtInt } from "../_components/formatters";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { optionLabel } from "./dokumaFilters";
import { bitisColumns } from "./leventColumns";
import { buildBitisTahminiExport } from "./leventExport";
import { enYakinBitis, secenekOptions, type FinishForecastRow } from "./leventReportTypes";
import { KumasKaynakStrip, HorizonLine, useUrlFilter } from "./leventShared";
import { dokumaReportsApi } from "./service";

export function LeventBitisTahminiPage() {
  const [machineId, setMachine] = useUrlFilter("machine");
  const q = useQuery({
    queryKey: ["reports", "dokuma", "levent-bitis-tahmini", machineId],
    queryFn: () => dokumaReportsApi.leventBitisTahmini({ machineId }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rapor = q.data?.data;
  const tezgahOptions = useMemo(() => secenekOptions(rapor?.meta.secenekler.machineId), [rapor]);
  const tezgah = optionLabel(tezgahOptions, machineId);
  const filterNotes = useMemo(() => (tezgah ? [`Tezgah: ${tezgah}`] : []), [tezgah]);
  const sourceTotals = useMemo(
    () => (rapor ? rapor.satirlar.reduce((a, r) => ({ otomatik: a.otomatik + r.kaynak.otomatik, elle: a.elle + r.kaynak.elle }), { otomatik: 0, elle: 0 }) : undefined),
    [rapor],
  );
  const spec = useMemo(() => () => (rapor ? buildBitisTahminiExport({ rapor, filterNotes }) : null), [rapor, filterNotes]);
  const o = rapor?.ozet;
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <DokumaFilterBar id="bitis-tezgah" label="Tezgah" value={machineId} options={tezgahOptions} onChange={setMachine} />
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/levent-bitis-tahmini"
      title="Levent Bitiş Tahmini"
      description={rapor ? `Kesit: kalan metre ÷ son ${rapor.meta.pencereGun} fabrika günü ortalama tüketim (${rapor.meta.pencereBaslangic} itibarıyla).` : "Kesit: kalan metre ÷ son 7 fabrika günü ortalama tüketim."}
      filters={filters}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={filterNotes} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Tezgahtaki levent" value={o ? fmtInt(o.leventSayisi) : null} isLoading={q.isLoading} />
        <MetricCard label="Tahminli" value={o ? fmtInt(o.tahminli) : null} hint="son 7 günde tüketimi olan" isLoading={q.isLoading} />
        <MetricCard label="Hesaplanamadı" value={o ? fmtInt(o.hesaplanamadi) : null} hint="tüketim yok — gün uydurulmaz" tone={o && o.hesaplanamadi > 0 ? "warn" : "neutral"} isLoading={q.isLoading} />
        <MetricCard label="En yakın bitiş" value={rapor ? fmtCalendarDate(enYakinBitis(rapor.satirlar)) : null} isLoading={q.isLoading} />
      </div>
      <KumasKaynakStrip kaynak={sourceTotals} baslik="Son 7 gün tüketim kaynağı" />
      <DetailTable<FinishForecastRow> title="Tezgahtaki leventler" data={rapor?.satirlar ?? []} columns={bitisColumns} isLoading={q.isLoading} emptyLabel="Tezgahta levent yok." />
      <HorizonLine meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
