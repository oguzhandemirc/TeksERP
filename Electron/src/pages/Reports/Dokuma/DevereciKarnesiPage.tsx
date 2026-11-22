// =============================================================================
// DEVERECİ KARNESİ (devere-levent S2) — devereci başına zamanında dönüş, süre, fire, ret, denye, çözgü hatası
// =============================================================================
// Süzgeçler SUNUCUDA (dönem · devereci); devereci seçenekleri raporun kendi `meta.secenekler`inden (liste ucu izni
// istemez — çıkışsız kapı yok). İstemci hesap yapmaz; null = ölçülemedi.
// =============================================================================
import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Callout } from "@/components/ui/callout";
import { apiErrorText } from "@/lib/api-error";
import { DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { useFactoryRange } from "./DokumaShared";
import { useUrlFilter } from "./leventShared";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { optionLabel } from "./dokumaFilters";
import { secenekOptions } from "./leventReportTypes";
import { KARNE_COLUMNS, buildKarneExport, devereciKarnesiApi, onTimeText, rejectText, warpDefectText, type KarneRow } from "./devereciKarnesi";

const columns: ColumnDef<KarneRow, unknown>[] = KARNE_COLUMNS.map((c) => ({
  id: c.key,
  meta: { exportValue: (r: KarneRow) => c.display(r) },
  header: () => <span className={c.align === "right" ? "block text-right" : undefined}>{c.header}</span>,
  cell: ({ row }) => {
    const text = c.display(row.original);
    const muted = text === "—" || text === "Ölçülemedi";
    return <span className={`${c.align === "right" ? "block text-right tabular-nums" : "font-medium"} ${muted ? "text-muted-foreground" : ""}`}>{text}</span>;
  },
}));

export function DevereciKarnesiPage() {
  const range = useFactoryRange("dokuma/devereci-karnesi");
  const [subcontractorId, setSub] = useUrlFilter("devereci");
  const q = useQuery({
    queryKey: ["reports", "dokuma", "devereci-karnesi", range.from, range.to, subcontractorId],
    queryFn: () => devereciKarnesiApi.report({ from: range.from, to: range.to, subcontractorId: subcontractorId || undefined }),
    enabled: range.ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const report = q.data?.data;
  const options = useMemo(() => secenekOptions(report?.meta.secenekler.subcontractorId), [report]);
  const subLabel = optionLabel(options, subcontractorId);
  const filterNotes = useMemo(() => (subLabel ? [`Devereci: ${subLabel}`] : []), [subLabel]);
  const spec = useMemo(() => () => (report ? buildKarneExport({ report, range, filterNotes }) : null), [report, range, filterNotes]);
  const o = report?.ozet;
  const filters = (
    <>
      <ReportDateFilter reportKey="dokuma/devereci-karnesi" />
      <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
        <DokumaFilterBar id="karne-devereci" label="Devereci" value={subcontractorId} options={options} onChange={setSub} />
      </div>
    </>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/devereci-karnesi"
      title="Devereci Karnesi"
      description="Fason deverecileri dönem içindeki teslimlere göre ölçer: zamanında dönüş, teslim süresi, fire, ret, denye sapması ve çözgü kaynaklı kumaş hatası."
      filters={filters}
      actions={<ReportExportBar disabled={!report} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={filterNotes} />
      {q.isError ? <Callout tone="danger">{apiErrorText(q.error, "Devereci karnesi alınamadı.")}</Callout> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Zamanında dönüş" value={o ? onTimeText(o.teslim) : null} hint="ilk levent termin gününe kadar kabul edilen sipariş" isLoading={q.isLoading} />
        <MetricCard label="Teslim süresi" value={o?.sure.medyanGun != null ? `${o.sure.medyanGun} gün` : o ? "—" : null} hint={o ? `medyan · ${o.sure.ornek} sipariş` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Ret oranı" value={o ? rejectText(o.ret) : null} hint="reddedilen ÷ dönen levent" tone={o?.ret.reddedilen ? "warn" : "neutral"} isLoading={q.isLoading} />
        <MetricCard label="Çözgü hatası / 100 m" value={o ? warpDefectText(o.cozguHatasi) : null} hint={o?.cozguHatasi.gerekce ?? "topa bağlı levent tüketiminden"} isLoading={q.isLoading} />
      </div>
      <DetailTable<KarneRow>
        title="Devereci başına"
        description="Zamanında: ilk leventin kabulü termin gününe kadar. Fire: kapanan siparişlerin fire yüzdesi ortalaması; tolerans aşımı kapanış sayısına göre."
        data={report?.satirlar ?? []}
        columns={columns}
        isLoading={q.isLoading}
        emptyLabel="Bu dönemde devereciden levent kabulü, kapanış ya da topa bağlı tüketim yok."
      />
      {report ? <p className="px-1 text-xs text-muted-foreground">Tezgah verisi {report.meta.ufuk} sonrası ölçülü.{report.meta.otomatikTuketim ? "" : " Otomatik levent tüketimi kapalı — çözgü hatası top ile levent bağı kurulamadığı için ölçülemez."}</p> : null}
    </ReportPageLayout>
  );
}
