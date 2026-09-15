import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, CheckCircle2, Factory, PackageSearch, Warehouse } from "lucide-react";
import { DetailTable, MetricCard, ReportExportBar, ReportPageLayout } from "../_components";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import {
  buildCoverageExport,
  openOrderCoverageApi,
  COVERAGE_STATE_LABEL,
  type CoverageBucketRow,
  type CoverageLineRow,
  type CoverageState,
} from "./openOrderCoverage";

const STATE_TONE: Record<CoverageState, string> = {
  HAZIR: "text-emerald-600 dark:text-emerald-400",
  KISMI: "text-amber-600 dark:text-amber-400",
  URETIM_GEREKLI: "text-destructive",
};

/** Sağa yaslı metraj kolonu — iki tabloda da aynı biçim. */
function qtyCol<T>(key: string, header: string, strong = false): ColumnDef<T, unknown> {
  return {
    accessorKey: key,
    header: () => <div className="text-right">{header}</div>,
    cell: ({ getValue }) => (
      <div className={`text-right tabular-nums ${strong ? "font-medium" : ""}`}>
        {fmtNum(getValue() as number)} m
      </div>
    ),
  };
}

const bucketColumns = (labelHeader: string): ColumnDef<CoverageBucketRow, unknown>[] => [
    { accessorKey: "label", header: labelHeader },
    {
      accessorKey: "lineCount",
      header: () => <div className="text-right">Kalem</div>,
      cell: ({ getValue }) => (
        <div className="text-right tabular-nums">{fmtInt(getValue() as number)}</div>
      ),
    },
    qtyCol<CoverageBucketRow>("openQty", "Açık"),
    qtyCol<CoverageBucketRow>("fromWarehouseQty", "Depodan"),
    qtyCol<CoverageBucketRow>("fromProductionQty", "Üretimde"),
    qtyCol<CoverageBucketRow>("uncoveredQty", "Karşılanamayan", true),
    {
      accessorKey: "coveragePct",
      header: () => <div className="text-right">Karşılanma</div>,
      cell: ({ getValue }) => {
        const p = getValue() as number;
        return (
          <div
            className={`text-right font-medium tabular-nums ${
              p >= 100 ? "text-emerald-600 dark:text-emerald-400" : p > 0 ? "text-amber-600 dark:text-amber-400" : "text-destructive"
            }`}
          >
            {fmtPercent(p)}
          </div>
        );
      },
    },
  ];

const lineColumns: ColumnDef<CoverageLineRow, unknown>[] = [
  { accessorKey: "orderNumber", header: "Sipariş" },
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "itemName", header: "Kumaş" },
  {
    accessorKey: "colorName",
    header: "Renk",
    cell: ({ getValue }) => <span>{(getValue() as string | null) ?? "—"}</span>,
  },
  {
    accessorKey: "deadline",
    header: "Termin",
    cell: ({ row }) => {
      const l = row.original;
      if (!l.deadline) return <span className="text-muted-foreground">—</span>;
      const d = new Date(l.deadline).toLocaleDateString("tr-TR");
      return l.daysLate != null ? (
        <span className="font-medium text-destructive">
          {d} <span className="text-[10px]">({fmtInt(l.daysLate)} gün geçti)</span>
        </span>
      ) : (
        <span>{d}</span>
      );
    },
  },
  qtyCol<CoverageLineRow>("openQty", "Açık"),
  qtyCol<CoverageLineRow>("fromWarehouseQty", "Depodan"),
  qtyCol<CoverageLineRow>("fromProductionQty", "Üretimde"),
  qtyCol<CoverageLineRow>("uncoveredQty", "Karşılanamayan", true),
  {
    accessorKey: "state",
    header: "Durum",
    cell: ({ getValue }) => {
      const s = getValue() as CoverageState;
      return <span className={`font-medium ${STATE_TONE[s]}`}>{COVERAGE_STATE_LABEL[s]}</span>;
    },
  },
];

export function OpenOrderCoveragePage() {
  const query = useQuery({
    queryKey: ["reports", "sales", "open-order-coverage"],
    queryFn: () => openOrderCoverageApi.get(),
    staleTime: 30_000,
  });

  const c = query.data?.data;
  const spec = useMemo(() => () => (c ? buildCoverageExport(c) : null), [c]);

  return (
    <ReportPageLayout
      reportKey="sales/open-order-coverage"
      title="Açık Sipariş Karşılanma"
      description="Açık siparişin ne kadarını bugün sevk edebilirim, ne kadarı için üretim gerekiyor."
      // Anlık fotoğraf: "bugün neyi sevk edebilirim" sorusunun dönemle işi yok
      // (Stok Karnesi ile aynı gerekçe).
      actions={<ReportExportBar disabled={!c} buildSpec={spec} />}
    >
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
