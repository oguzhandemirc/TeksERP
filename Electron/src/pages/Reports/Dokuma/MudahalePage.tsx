// =============================================================================
// MÜDAHALE / ÇÖZÜM SÜRESİ (B4) — tezgah alarmı defterinden ortalama üstlenme ve çözüm süresi,
// hedef (K2 vadesi) aşım oranı; kırılım sekmeleri. Usta kırılımını SUNUCU yalnız yetkiliye döndürür.
// =============================================================================
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportDateFilter, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtInt, fmtPercent } from "../_components/formatters";
import { useFactoryRange } from "./DokumaShared";
import { buildMudahaleExport, fmtDuration, mudahaleAxes, MUDAHALE_AXIS_LABELS, MUDAHALE_NOTE, type MudahaleAxis } from "./mudahaleExport";
import { dokumaReportsApi, type AlarmResponseRow } from "./service";

function columnsFor(axis: MudahaleAxis): ColumnDef<AlarmResponseRow>[] {
  return [
    { accessorKey: "etiket", header: MUDAHALE_AXIS_LABELS[axis] },
    { accessorKey: "alarm", header: "Alarm", cell: ({ getValue }) => fmtInt(getValue() as number) },
    { accessorKey: "ustlenmeOrtSn", header: "Ort. üstlenme", cell: ({ getValue }) => fmtDuration(getValue() as number | null) },
    { accessorKey: "cozumOrtSn", header: "Ort. çözüm", cell: ({ getValue }) => fmtDuration(getValue() as number | null) },
    { accessorKey: "asimOraniPct", header: "Aşım oranı", cell: ({ row }) => `${fmtPercent(row.original.asimOraniPct)} (${row.original.asim}/${row.original.asim + row.original.zamaninda})` },
    { accessorKey: "belirsiz", header: "Belirsiz", cell: ({ getValue }) => fmtInt(getValue() as number) },
    { accessorKey: "hedefsiz", header: "Hedefsiz", cell: ({ getValue }) => fmtInt(getValue() as number) },
    { accessorKey: "iptal", header: "İptal", cell: ({ getValue }) => fmtInt(getValue() as number) },
  ];
}

export function MudahalePage() {
  const range = useFactoryRange("dokuma/mudahale");
  const [axis, setAxis] = useState<MudahaleAxis>("sebepler");
  const q = useQuery({
    queryKey: ["reports", "dokuma", "mudahale", range.from, range.to],
    queryFn: () => dokumaReportsApi.mudahale({ from: range.from, to: range.to }),
    enabled: range.ready,
    staleTime: 30_000,
  });
  const rapor = q.data?.data;
  const warnings = useMemo(() => q.data?.warnings ?? [], [q.data]);
  const axes = mudahaleAxes(rapor);
  // Yetki değişip kişi ekseni kalkarsa seçim geçerli bir eksene düşer.
  const active: MudahaleAxis = axes.includes(axis) ? axis : "sebepler";
  const columns = useMemo(() => columnsFor(active), [active]);
  const periodLabel = `${range.from} – ${range.to} (fabrika günü, alarm doğuşu)`;
  const spec = useMemo(
    () => () => (rapor ? buildMudahaleExport({ rapor, axis: active, periodLabel, warnings }) : null),
    [rapor, active, periodLabel, warnings],
  );
  const o = rapor?.ozet;
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="dokuma/mudahale" bare />
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Kırılım">
        {axes.map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            aria-selected={a === active}
            onClick={() => setAxis(a)}
            className={`rounded-md border px-3 py-1.5 text-sm ${a === active ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
          >
            {MUDAHALE_AXIS_LABELS[a]}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/mudahale"
      title="Müdahale ve Çözüm Süresi"
      description="Tezgah alarmları ne kadar sürede üstlenildi ve çözüldü; çözüm hedefi (K2 vadesi) kaç alarmda aşıldı."
      filters={filters}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={warnings} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Alarm" value={o ? fmtInt(o.alarm) : null} hint={o ? `${fmtInt(o.iptal)} iptal ayrıca` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Ort. üstlenme" value={o ? fmtDuration(o.ustlenmeOrtSn) : null} hint={o ? `${fmtInt(o.ustlenilen)} üstlenilen alarm` : undefined} isLoading={q.isLoading} />
        <MetricCard label="Ort. çözüm" value={o ? fmtDuration(o.cozumOrtSn) : null} hint={o ? `${fmtInt(o.cozulen)} çözülen alarm` : undefined} isLoading={q.isLoading} />
        <MetricCard
          label="Hedef aşım oranı"
          value={o ? fmtPercent(o.asimOraniPct) : null}
          hint={o ? `${fmtInt(o.asim)}/${fmtInt(o.asim + o.zamaninda)} · belirsiz ${fmtInt(o.belirsiz)} · hedefsiz ${fmtInt(o.hedefsiz)}` : undefined}
          tone={o && o.asimOraniPct !== null && o.asimOraniPct > 0 ? "warn" : "neutral"}
          isLoading={q.isLoading}
        />
      </div>
      <p className="text-xs text-muted-foreground">{MUDAHALE_NOTE}</p>
      <DetailTable<AlarmResponseRow> title={`${MUDAHALE_AXIS_LABELS[active]} kırılımı`} data={rapor?.[active] ?? []} columns={columns} isLoading={q.isLoading} />
    </ReportPageLayout>
  );
}
