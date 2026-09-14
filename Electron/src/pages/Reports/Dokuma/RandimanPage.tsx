// =============================================================================
// RANDIMAN — tezgah × vardiya; A · P · E AYRI sütun, ÇARPILMAZ; null → "ölçülemedi"
// =============================================================================
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { buildRandimanExport } from "./dokumaExport";
import { HorizonNote, SealBadge, SourceBreakdownStrip, fmtSec, useFactoryRange } from "./DokumaShared";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";
import { dokumaReportsApi, type EfficiencyRow } from "./service";

const columns: ColumnDef<EfficiencyRow>[] = [
  { accessorKey: "machine.code", header: "Tezgah", cell: ({ row }) => `${row.original.machine.code} · ${row.original.machine.name}` },
  { accessorKey: "factoryDayKey", header: "Gün", cell: ({ getValue }) => String(getValue()).slice(0, 10) },
  { accessorKey: "shift.name", header: "Vardiya", cell: ({ row }) => row.original.shift.name },
  { accessorKey: "source", header: "Kaynak", cell: ({ row }) => (row.original.emptyLoom ? "Boş tezgah" : SOURCE_LABELS[row.original.source]) },
  { accessorKey: "potSec", header: "Planlı", cell: ({ getValue }) => fmtSec(getValue() as number) },
  { accessorKey: "aptSec", header: "Çalıştı", cell: ({ getValue }) => fmtSec(getValue() as number) },
  { accessorKey: "unitsActual", header: "Atkı", cell: ({ getValue }) => fmtInt(getValue() as number) },
  { accessorKey: "availabilityPct", header: "Kullanılabilirlik", cell: ({ getValue }) => formatPct(getValue() as number | null) },
  { accessorKey: "performancePct", header: "Performans", cell: ({ row }) => formatPct(row.original.performancePct) + (row.original.performancePct === null && row.original.olculemedi.P ? ` (${row.original.olculemedi.P})` : "") },
  { accessorKey: "effectivenessPct", header: "Etkinlik", cell: ({ getValue }) => formatPct(getValue() as number | null) },
  { accessorKey: "sealState", header: "Durum", cell: ({ row }) => <SealBadge sealState={row.original.sealState} live={row.original.live} /> },
  { accessorKey: "warnings", header: "Uyarı", cell: ({ row }) => (row.original.warnings.length ? `${row.original.warnings.length}` : "") },
];

export function RandimanPage() {
  const range = useFactoryRange(7);
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "dokuma", "randiman", range.from, range.to],
    queryFn: () => dokumaReportsApi.efficiency({ from: range.from, to: range.to }),
    enabled: range.ready,
    staleTime: 30_000,
  });
  const rapor = data?.data;
  const totals = rapor?.toplam;
  const excluded = totals ? `dışlanan A ${totals.olculemedi.A} · P ${totals.olculemedi.P} · E ${totals.olculemedi.E}` : undefined;
  // Çıktı başlığı SÜZGECİ söyler (fabrika günü penceresi) — dosya tek başına
  // paylaşıldığında hangi aralığın rakamı olduğu kâğıttan okunsun.
  const periodLabel = `${range.from} – ${range.to} (fabrika günü)`;
  const spec = useMemo(() => () => (rapor ? buildRandimanExport({ rapor, periodLabel }) : null), [rapor, periodLabel]);

  return (
    <ReportPageLayout
      title="Randıman"
      description="Kullanılabilirlik, performans ve etkinlik AYRI sunulur, çarpılmaz. Payda yoksa oran 'ölçülemedi'dir — sıfır değil."
      defaultDays={7}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Kullanılabilirlik (Σ)" value={totals ? formatPct(totals.availabilityPct) : null} hint="Σ çalıştı / Σ planlı" isLoading={isLoading} />
        <MetricCard label="Performans (Σ)" value={totals ? formatPct(totals.performancePct) : null} hint="Σ atkı / Σ hedef (çalışırken)" isLoading={isLoading} />
        <MetricCard label="Etkinlik (Σ)" value={totals ? formatPct(totals.effectivenessPct) : null} hint="Σ atkı / Σ hedef (planlı)" isLoading={isLoading} />
        <MetricCard label="Satır" value={totals ? fmtInt(totals.rowCount) : null} hint={excluded} isLoading={isLoading} tone={totals && totals.olculemedi.P > 0 ? "warn" : "neutral"} />
      </div>
      <SourceBreakdownStrip kirilim={rapor?.kaynakKirilimi} />
      <DetailTable<EfficiencyRow> title="Tezgah × vardiya" data={rapor?.satirlar ?? []} columns={columns} isLoading={isLoading} />
      <HorizonNote meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
