import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Factory, PackageSearch, Warehouse } from "lucide-react";
import { DetailTable, MetricCard, ReportAxisBar, ReportExportBar, ReportFilterNotes, ReportPageLayout } from "../_components";
import { useAxisNotes, useReportAxes } from "../_hooks/useReportAxes";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { bucketColumns, lineColumns } from "./openOrderCoverageColumns";
import { buildCoverageExport, openOrderCoverageApi, type CoverageBucketRow, type CoverageLineRow } from "./openOrderCoverage";


// ⚠️ YALNIZ KUMAŞ: müşteri ekseni BİLEREK yok — karşılama havuzu FIFO'dur ve
// spec başına paylaştırılır; müşteriye süzülen bir kapsama yüzdesi yalan söyler
// (6e ölçtü, raporlar.md:94 kapsam dışı beyanı).
const AXIS_KEYS = ["itemId"] as const;

export function OpenOrderCoveragePage() {
  const axes = useReportAxes();

  const query = useQuery({
    queryKey: ["reports", "sales", "open-order-coverage", axes.params],
    queryFn: () => openOrderCoverageApi.get(axes.params),
    staleTime: 30_000,
  });

  const c = query.data?.data;
  const { secenekler, notes: suzgecNotlari } = useAxisNotes(query.data, axes.sel, AXIS_KEYS);
  const spec = useMemo(() => () => (c ? buildCoverageExport(c, suzgecNotlari) : null), [c, suzgecNotlari]);

  return (
    <ReportPageLayout
      reportKey="sales/open-order-coverage"
      title="Açık Sipariş Karşılanma"
      description="Açık siparişin ne kadarını bugün sevk edebilirim, ne kadarı için üretim gerekiyor."
      // Anlık fotoğraf: "bugün neyi sevk edebilirim" sorusunun dönemle işi yok
      // (Stok Karnesi ile aynı gerekçe).
      filters={<ReportAxisBar reportKey="sales/open-order-coverage" axes={axes} secenekler={secenekler} eksenler={AXIS_KEYS} />}
      actions={<ReportExportBar disabled={!c} buildSpec={spec} />}
    >
      <ReportFilterNotes notes={suzgecNotlari} />
      {c && c.linesOmitted > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{fmtInt(c.linesOmitted)} kalem</strong> detay tablosuna sığmadı (tavan 500).
            Yukarıdaki özet ve kırılım rakamları <strong>tüm</strong> kalemleri kapsar; aşağıdaki
            liste kapsamaz. Excel çıktısında da aynı uyarı yazılıdır.
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Açık sipariş"
          value={`${fmtNum(c?.summary.openQty)} m`}
          hint={c ? `${fmtInt(c.summary.openLineCount)} kalem` : undefined}
          icon={PackageSearch}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Depodan karşılanır"
          value={`${fmtNum(c?.summary.fromWarehouseQty)} m`}
          hint={c ? `${fmtInt(c.summary.fullyCoveredLines)} kalem bugün sevk edilebilir` : undefined}
          icon={Warehouse}
          tone="ok"
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Üretimde"
          value={`${fmtNum(c?.summary.fromProductionQty)} m`}
          hint="Canlı iş emirlerindeki mal"
          icon={Factory}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Karşılanamayan"
          value={`${fmtNum(c?.summary.uncoveredQty)} m`}
          hint={c ? `${fmtInt(c.summary.uncoveredLines)} kalem — iş emri gerekiyor` : undefined}
          icon={AlertTriangle}
          tone={c === undefined ? "neutral" : c.summary.uncoveredQty > 0 ? "bad" : "ok"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Karşılanma oranı"
          value={fmtPercent(c?.summary.coveragePct)}
          hint={c ? `Malzeme açığı ${fmtNum(c.summary.materialGapQty)} m` : undefined}
          icon={CheckCircle2}
          tone={
            c === undefined ? "neutral" : c.summary.coveragePct >= 80 ? "ok" : c.summary.coveragePct >= 40 ? "warn" : "bad"
          }
          isLoading={query.isLoading}
        />
      </div>

      {c && c.summary.overdueUncoveredLines > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong>{fmtInt(c.summary.overdueUncoveredLines)} kalemin</strong> termini geçmiş ve hâlâ
            karşılanamıyor ({fmtNum(c.summary.overdueUncoveredQty)} m). Liste bunları en üste alır.
          </span>
        </div>
      ) : null}

      <DetailTable<CoverageBucketRow>
        title="Müşteri kırılımı"
        description="Karşılanamayan metrajı en yüksek müşteri üstte."
        data={c?.byCustomer ?? []}
        columns={bucketColumns("Müşteri")}
        isLoading={query.isLoading}
      />

      <DetailTable<CoverageBucketRow>
        title="Kumaş kırılımı"
        description="Hangi kumaşta üretim baskısı var."
        data={c?.byItem ?? []}
        columns={bucketColumns("Kumaş")}
        isLoading={query.isLoading}
      />

      <DetailTable<CoverageLineRow>
        title="Kalemler"
        description="Termini geçmiş olanlar önce. Aynı kumaş+renk+en'i isteyen kalemler stok havuzunu PAYLAŞIR — havuz en acil kalemden başlayarak dağıtılır."
        data={c?.lines ?? []}
        columns={lineColumns}
        isLoading={query.isLoading}
      />
    </ReportPageLayout>
  );
}
