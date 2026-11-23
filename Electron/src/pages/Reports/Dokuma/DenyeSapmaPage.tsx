// =============================================================================
// DENYE SAPMASI (Devere F2) — tartılı fason devere leventleri ↔ iplik kartı denyesi; öneri yalnız onayla uygulanır
// =============================================================================
// Süzgeçler SUNUCUDA (kabul günü · iplik · devereci); istemci hesap yapmaz. [Uygula] yalnız `item:write`.
// =============================================================================
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { useRoleAccess } from "@/hooks/useRoleAccess";
import { apiErrorText } from "@/lib/api-error";
import { formatDisplay } from "@/lib/format";
import { DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { useFactoryRange } from "./DokumaShared";
import { useUrlFilter } from "./leventShared";
import { DenyeFilterBar } from "./DenyeFilterBar";
import { DenyeUygulaDialog } from "./DenyeUygulaDialog";
import { DENYE_COLUMNS, buildDenyeExport, denyeLines, denyeSapmaApi, type DenierReport, type DenierRow, type DenyeLine } from "./denyeSapma";

function buildColumns(settings: DenierReport["settings"] | undefined, onApply: ((r: DenierRow) => void) | null): ColumnDef<DenyeLine, unknown>[] {
  return DENYE_COLUMNS.map((c) => ({
    id: c.key,
    // Tablo dışa aktarımı da ekrandaki metni aynı kurucudan alır.
    meta: { exportValue: (l: DenyeLine) => c.display(l, settings) },
    header: () => <span className={c.align === "right" ? "block text-right" : undefined}>{c.header}</span>,
    cell: ({ row }) => {
      const l = row.original;
      const text = c.display(l, settings);
      if (c.key === "oneri" && l.kind === "yarn" && l.row.status === "SUGGEST") {
        return (
          <span className="flex items-center gap-2">
            <span className="font-medium tabular-nums">{text}</span>
            {onApply ? <Button size="sm" variant="outline" className="h-7" onClick={() => onApply(l.row)}>Uygula</Button> : null}
          </span>
        );
      }
      const muted = l.kind === "mixed" || c.key === "oneri";
      return <span className={`${c.align === "right" ? "block text-right tabular-nums" : ""} ${muted ? "text-muted-foreground" : ""}`}>{text}</span>;
    },
  }));
}

export function DenyeSapmaPage() {
  const range = useFactoryRange("dokuma/denye-sapma");
  const [yarnItemId, setYarn] = useUrlFilter("yarn");
  const [subcontractorId, setSub] = useUrlFilter("devereci");
  const [labels, setLabels] = useState<{ yarn?: string; sub?: string }>({});
  const [target, setTarget] = useState<DenierRow | null>(null);
  const canApply = useRoleAccess().hasPermission("item:write");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["reports", "dokuma", "denye-sapma", range.from, range.to, yarnItemId, subcontractorId],
    queryFn: () => denyeSapmaApi.report({ from: range.from, to: range.to, yarnItemId: yarnItemId || undefined, subcontractorId: subcontractorId || undefined }),
    enabled: range.ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const report = q.data?.data;
  const lines = useMemo(() => denyeLines(report), [report]);
  const filterNotes = useMemo(() => [
    ...(yarnItemId ? [`İplik: ${labels.yarn ?? "seçili"}`] : []),
    ...(subcontractorId ? [`Devereci: ${labels.sub ?? "seçili"}`] : []),
  ], [yarnItemId, subcontractorId, labels]);
  const spec = useMemo(() => () => (report ? buildDenyeExport({ report, filterNotes }) : null), [report, filterNotes]);
  const columns = useMemo(() => buildColumns(report?.settings, canApply ? setTarget : null), [report?.settings, canApply]);
  const suggestCount = report?.rows.filter((r) => r.status === "SUGGEST").length;
  const filters = (
    <>
      <ReportDateFilter reportKey="dokuma/denye-sapma" />
      <DenyeFilterBar
        yarnItemId={yarnItemId}
        subcontractorId={subcontractorId}
        onYarn={(id, label) => { setYarn(id); setLabels((p) => ({ ...p, yarn: label })); }}
        onSubcontractor={(id, label) => { setSub(id); setLabels((p) => ({ ...p, sub: label })); }}
      />
    </>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/denye-sapma"
      title="Denye Sapması"
      description="Tartılı devere leventlerinin net kilosu, iplik kartındaki denyeyle hesaplanan nominal kiloyla karşılaştırılır; öneri kartı kendiliğinden değiştirmez."
      filters={filters}
      actions={<ReportExportBar disabled={!report} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={filterNotes} />
      {q.isError ? <Callout tone="danger">{apiErrorText(q.error, "Denye sapma raporu alınamadı.")}</Callout> : null}
      {/* Öneri koşulu bir AYAR, sayı değil: kart olarak değil "Öneri bekleyen" kartının ipucunda. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="İplik" value={report ? formatDisplay(report.rows.length, 0) : null} hint="tek iplikli tartılı leventi olan" isLoading={q.isLoading} />
        <MetricCard
          label="Öneri bekleyen"
          value={suggestCount === undefined ? null : formatDisplay(suggestCount, 0)}
          hint={report ? `en az ${report.settings.minBeams} levent, karta göre %${formatDisplay(report.settings.thresholdPct, 2)} üstü sapma` : undefined}
          tone={suggestCount ? "warn" : "neutral"}
          isLoading={q.isLoading}
        />
        <MetricCard label="Karma levent" value={report ? formatDisplay(report.mixed?.beamCount ?? 0, 0) : null} hint="çok iplikli — ipliğe bölünemez" isLoading={q.isLoading} />
      </div>
      <DetailTable<DenyeLine>
        title="İplik başına tartı ↔ nominal"
        description="Sapma: tartı neti nominal kilodan ne kadar farklı. Karta göre: tartıdan bulunan denye karttakinden ne kadar farklı."
        data={lines}
        columns={columns}
        isLoading={q.isLoading}
        emptyLabel="Bu aralıkta tartılı (brüt + dara girilmiş) kabul edilmiş devere leventi yok."
      />
      {target ? (
        <DenyeUygulaDialog row={target} onClose={() => setTarget(null)} onApplied={() => void qc.invalidateQueries({ queryKey: ["reports", "dokuma", "denye-sapma"] })} />
      ) : null}
    </ReportPageLayout>
  );
}
