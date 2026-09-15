// =============================================================================
// RANDIMAN — tezgah × vardiya; A · P · E AYRI sütun, ÇARPILMAZ; null → "ölçülemedi"
// =============================================================================
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportExportBar, ReportDateFilter, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { buildRandimanExport } from "./dokumaExport";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { LotInput } from "../_components/LotInput";
import { useBeamLot } from "../_hooks/useBeamLot";
import { beamLotNotes } from "../_hooks/reportAxisFilters";
import { beamOptionsFrom, machineOptionsFrom, optionLabel, pickReportData } from "./dokumaFilters";
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
  const range = useFactoryRange("dokuma/randiman");
  const [sp, setSp] = useSearchParams();
  const machineId = sp.get("machine") ?? "";
  // PENCERE sorgusu: süzgeçsiz. Seçenek listesi HER ZAMAN buradan doğar —
  // süzgeçli yanıttan doğsaydı seçim sonrası liste tek öğeye daralırdı.
  const beamLot = useBeamLot();
  const pencere = useQuery({
    queryKey: ["reports", "dokuma", "randiman", range.from, range.to],
    queryFn: () => dokumaReportsApi.efficiency({ from: range.from, to: range.to }),
    enabled: range.ready,
    staleTime: 30_000,
  });
  // TEK süzgeçli sorgu: tezgah · levent · lot aynı istekte birleşir (kesişim).
  const suzgecli = useQuery({
    queryKey: ["reports", "dokuma", "randiman", range.from, range.to, machineId, beamLot.params],
    queryFn: () => dokumaReportsApi.efficiency({ from: range.from, to: range.to, machineId, ...beamLot.params }),
    enabled: range.ready && (machineId !== "" || beamLot.any),
    staleTime: 30_000,
  });
  const suzgecVar = machineId !== "" || beamLot.any;
  const isLoading = pencere.isLoading || (suzgecVar && suzgecli.isLoading);
  const data = pickReportData({ windowData: pencere.data, filteredData: suzgecli.data, filterId: suzgecVar ? "1" : "" });
  const rapor = data?.data;
  const machineOptions = useMemo(() => machineOptionsFrom(pencere.data?.data.satirlar), [pencere.data]);
  const machineLabel = optionLabel(machineOptions, machineId);
  // Levent seçenekleri de SÜZGEÇSİZ yanıttan: süzgeçli yanıt da tam liste döner
  // ama pencere yanıtı her zaman var, tek kaynak karışıklığı olmasın.
  const beamOptions = useMemo(() => beamOptionsFrom(pencere.data?.data.meta.leventler), [pencere.data]);
  const suzgecNotlari = useMemo(
    () => beamLotNotes({ beamLabel: optionLabel(beamOptions, beamLot.beamId), lotNo: beamLot.lotNo, suzgec: data?.suzgec }),
    [beamOptions, beamLot.beamId, beamLot.lotNo, data],
  );
  const totals = rapor?.toplam;
  const excluded = totals ? `dışlanan A ${totals.olculemedi.A} · P ${totals.olculemedi.P} · E ${totals.olculemedi.E}` : undefined;
  // Çıktı başlığı SÜZGECİ söyler (fabrika günü penceresi) — dosya tek başına
  // paylaşıldığında hangi aralığın rakamı olduğu kâğıttan okunsun.
  const periodLabel = `${range.from} – ${range.to} (fabrika günü)`;
  const spec = useMemo(
    () => () => (rapor ? buildRandimanExport({ rapor, periodLabel, filterLabel: machineLabel, extraNotes: suzgecNotlari }) : null),
    [rapor, periodLabel, machineLabel, suzgecNotlari],
  );
  const filters = (
    <div className="flex flex-wrap items-end gap-3 border-b px-4 py-3">
      <ReportDateFilter reportKey="dokuma/randiman" bare />
      <DokumaFilterBar
        id="randiman-makine"
        label="Tezgah"
        value={machineId}
        options={machineOptions}
        onChange={(id) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set("machine", id); else n.delete("machine"); return n; }, { replace: true })}
      />
      <DokumaFilterBar
        id="randiman-levent"
        label="Levent"
        value={beamLot.beamId}
        options={beamOptions}
        onChange={beamLot.setBeam}
      />
      <LotInput id="randiman-lot" value={beamLot.lotNo} onChange={beamLot.setLot} />
    </div>
  );

  return (
    <ReportPageLayout
      reportKey="dokuma/randiman"
      title="Randıman"
      description="Kullanılabilirlik, performans ve etkinlik AYRI sunulur, çarpılmaz. Payda yoksa oran 'ölçülemedi'dir — sıfır değil."
      filters={filters}
      actions={<ReportExportBar disabled={!rapor} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={suzgecNotlari} />
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
