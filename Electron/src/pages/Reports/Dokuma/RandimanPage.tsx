// =============================================================================
// RANDIMAN — tezgah × vardiya; A · P · E AYRI sütun, ÇARPILMAZ; null → "ölçülemedi"
// =============================================================================
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable, MetricCard, ReportExportBar, ReportDateFilter, ReportFilterNotes, ReportPageLayout } from "../_components";
import { fmtInt } from "../_components/formatters";
import { buildRandimanExport } from "./dokumaExport";
import { DokumaFilterBar } from "./DokumaFilterBar";
import { LotInput } from "../_components/LotInput";
import { useBeamLot } from "../_hooks/useBeamLot";
import { beamLotNotes } from "../_hooks/reportAxisFilters";
import { beamOptionsFrom, machineOptionsFrom, optionLabel, pickReportData } from "./dokumaFilters";
import { HorizonNote, LoadMoreRows, SealBadge, SourceBreakdownStrip, fmtSec, useFactoryRange } from "./DokumaShared";
import { SOURCE_LABELS, formatPct } from "./dokuma-regime";
import { DOKUMA_PAGE_LIMIT, dokumaReportsApi, mergeEfficiencyPages, type EfficiencyRow, type RangeParams } from "./service";

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

/** Satır listesi SUNUCUDA sayfalı (toplamlar tam kümeden); sonraki sayfa "Daha fazla" ile. */
const pagedEfficiencyQuery = (p: RangeParams) => ({
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }: { pageParam: string | undefined }) => dokumaReportsApi.efficiency({ ...p, limit: DOKUMA_PAGE_LIMIT, ...(pageParam ? { cursor: pageParam } : {}) }),
  getNextPageParam: (last: Awaited<ReturnType<typeof dokumaReportsApi.efficiency>>) => last.data?.meta.nextCursor ?? undefined,
  staleTime: 30_000,
});

export function RandimanPage() {
  const range = useFactoryRange("dokuma/randiman");
  const [sp, setSp] = useSearchParams();
  const machineId = sp.get("machine") ?? "";
  // PENCERE sorgusu: süzgeçsiz. Seçenek listesi HER ZAMAN buradan doğar —
  // süzgeçli yanıttan doğsaydı seçim sonrası liste tek öğeye daralırdı.
  const beamLot = useBeamLot();
  const pencereQ = useInfiniteQuery({
    queryKey: ["reports", "dokuma", "randiman", range.from, range.to],
    ...pagedEfficiencyQuery({ from: range.from, to: range.to }),
    enabled: range.ready,
  });
  // TEK süzgeçli sorgu: tezgah · levent · lot aynı istekte birleşir (kesişim).
  const suzgecliQ = useInfiniteQuery({
    queryKey: ["reports", "dokuma", "randiman", range.from, range.to, machineId, beamLot.params],
    ...pagedEfficiencyQuery({ from: range.from, to: range.to, machineId, ...beamLot.params }),
    enabled: range.ready && (machineId !== "" || beamLot.any),
  });
  const pencereData = useMemo(() => mergeEfficiencyPages(pencereQ.data?.pages), [pencereQ.data]);
  const suzgecliData = useMemo(() => mergeEfficiencyPages(suzgecliQ.data?.pages), [suzgecliQ.data]);
  const suzgecVar = machineId !== "" || beamLot.any;
  const aktif = suzgecVar ? suzgecliQ : pencereQ;
  const isLoading = pencereQ.isLoading || (suzgecVar && suzgecliQ.isLoading);
  const data = pickReportData({ windowData: pencereData, filteredData: suzgecliData, filterId: suzgecVar ? "1" : "" });
  const rapor = data?.data;
  const machineOptions = useMemo(() => machineOptionsFrom(pencereData?.data.satirlar), [pencereData]);
  const machineLabel = optionLabel(machineOptions, machineId);
  // Levent seçenekleri de SÜZGEÇSİZ yanıttan: süzgeçli yanıt da tam liste döner
  // ama pencere yanıtı her zaman var, tek kaynak karışıklığı olmasın.
  const beamOptions = useMemo(() => beamOptionsFrom(pencereData?.data.meta.leventler), [pencereData]);
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
      <LoadMoreRows loaded={rapor?.satirlar.length ?? 0} total={rapor?.meta.total} hasMore={!!aktif.hasNextPage} loading={aktif.isFetchingNextPage} onMore={() => void aktif.fetchNextPage()} />
      <HorizonNote meta={rapor?.meta} />
    </ReportPageLayout>
  );
}
