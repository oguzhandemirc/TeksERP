import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Boxes, Layers, PackageSearch, Warehouse } from "lucide-react";
import { ChartCard, DetailTable, MetricCard, ReportExportBar, ReportPageLayout, SimpleBarChart } from "../_components";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { buildStockExport, stockScorecardApi, type StockScorecard } from "./stockScorecard";

type ItemRow = StockScorecard["byItem"][number];
type OldRow = StockScorecard["oldest"][number];

const ageTone = (d: number | null) => (d === null ? "" : d > 90 ? "text-destructive" : d > 30 ? "text-warning" : "");

const itemColumns: ColumnDef<ItemRow, unknown>[] = [
  { accessorKey: "label", header: "Kumaş" },
  {
    accessorKey: "count",
    header: () => <div className="text-right">Top</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtInt(getValue() as number)}</div>,
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Stok</div>,
    cell: ({ getValue }) => <div className="text-right font-medium tabular-nums">{fmtNum(getValue() as number)} m</div>,
  },
  {
    accessorKey: "uncoveredQty",
    header: () => <div className="text-right">Siparişsiz</div>,
    cell: ({ row }) => {
      const v = row.original.uncoveredQty;
      const share = row.original.qty > 0 ? (v / row.original.qty) * 100 : 0;
      return (
        <div className={`text-right tabular-nums ${share > 80 ? "text-warning" : "text-muted-foreground"}`}>
          {fmtNum(v)} m
          <div className="text-[10px]">{fmtPercent(Math.round(share * 10) / 10)}</div>
        </div>
      );
    },
  },
  {
    accessorKey: "oldestDays",
    header: () => <div className="text-right">En eski</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number | null;
      return d === null ? (
        <div className="text-right text-muted-foreground">—</div>
      ) : (
        <div className={`text-right tabular-nums ${ageTone(d)}`}>{fmtNum(d)} gün</div>
      );
    },
  },
];

const oldColumns: ColumnDef<OldRow, unknown>[] = [
  { accessorKey: "barcode", header: "Barkod", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  {
    id: "spec",
    header: "Kumaş / Renk",
    cell: ({ row }) => (
      <span>
        {row.original.itemName}
        {row.original.colorName ? <span className="text-muted-foreground"> · {row.original.colorName}</span> : null}
      </span>
    ),
  },
  { accessorKey: "status", header: "Durum" },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Metraj</div>,
    cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>,
  },
  {
    accessorKey: "days",
    header: () => <div className="text-right">Yaş</div>,
    cell: ({ getValue }) => {
      const d = getValue() as number;
      return <div className={`text-right font-medium tabular-nums ${ageTone(d)}`}>{fmtNum(d)} gün</div>;
    },
  },
];

export function StockScorecardPage() {
  const query = useQuery({
    queryKey: ["reports", "inventory", "scorecard"],
    queryFn: () => stockScorecardApi.get(),
    staleTime: 30_000,
  });

  const sc = query.data?.data;
  const spec = useMemo(() => () => (sc ? buildStockExport(sc) : null), [sc]);

  return (
    <ReportPageLayout
      reportKey="inventory/scorecard"
      title="Stok & Ölü Stok"
      description="Rafta ne var, kaç gündür duruyor ve siparişi var mı — nakit sıkışmasının kaynağı."
      // Anlık durum raporu: tarih aralığı YOK. "Şu an rafta ne var" sorusunu
      // filtrelemek anlamsızdır.
      actions={<ReportExportBar disabled={!sc} buildSpec={spec} />}
    >
      {sc && sc.summary.unagedCount > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            <strong>{fmtInt(sc.summary.unagedCount)} topun</strong> ({fmtNum(sc.summary.unagedQty)} m) yaşı
            bilinmiyor — yaş dağılımına dahil değil. "Yaşı bilinmiyor", "yeni" demek değildir; bu toplar ölü
            stok hesabına da girmez.
          </span>
        </div>
      ) : null}

      {/* ⚠️ 5 kart lg'de (1024px) SIKIŞIYOR — ölçüldü: "9283,8 m" iki satıra
          kırılıyordu. Beşli sıra yalnız xl'den (1280px) itibaren; arada üçlü. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Ölü stok"
          value={`${fmtNum(sc?.summary.deadQty)} m`}
          hint={sc ? `${sc.summary.deadStockDays} günden eski VE siparişsiz` : undefined}
          icon={AlertTriangle}
          tone={sc === undefined ? "neutral" : sc.summary.deadQty > 0 ? "bad" : "ok"}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Bitmiş depo"
          value={`${fmtNum(sc?.summary.finishedQty)} m`}
          hint={sc ? `${fmtInt(sc.summary.finishedCount)} top` : undefined}
          icon={Warehouse}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Ham stok"
          value={`${fmtNum(sc?.summary.rawQty)} m`}
          hint={sc ? `${fmtInt(sc.summary.rawCount)} top — işlenmeyi bekliyor` : undefined}
          icon={Boxes}
          isLoading={query.isLoading}
        />
        {/* Yarı mamul AYRI kart: aynı statüyü (STOCK) paylaşır ama farklı stok
            türüdür ve Envanter'de de ayrı sekmede durur. Tek rakamda toplamak
            "ekran 800 diyor, rapor 950 diyor" çelişkisini üretirdi. */}
        <MetricCard
          label="Yarı mamul"
          value={`${fmtNum(sc?.summary.semiQty)} m`}
          hint={sc ? `${fmtInt(sc.summary.semiCount)} top — dışarıdan boyalı geldi` : undefined}
          icon={Layers}
          isLoading={query.isLoading}
        />
        <MetricCard
          label="Eşikten eski"
          value={`${fmtNum(sc?.summary.agedQty)} m`}
          // Bu, ölü stoktan FARKLI ve büyük olması normal: siparişi olan eski
          // mal da buraya girer. İkisini karıştırmamak için hint açık yazıyor.
          hint="Siparişi olsa da olmasa da — ölü stokla aynı şey değil"
          icon={PackageSearch}
          isLoading={query.isLoading}
        />
      </div>

      <ChartCard
        title="Yaş dağılımı (bitmiş depo)"
        height={220}
        isLoading={query.isLoading}
        isEmpty={!query.isLoading && (sc?.byAge.every((b) => b.qty === 0) ?? true)}
      >
        <SimpleBarChart
          data={sc?.byAge ?? []}
          xKey="label"
          bars={[{ key: "qty", label: "Metraj (m)" }]}
          formatValue={(v) => fmtNum(v)}
        />
      </ChartCard>

      <DetailTable
        title="Kumaş Bazında"
        description="Siparişsiz metraj SPEC bazındadır (kumaş+renk+en) — hangi fiziksel topun karşılıksız olduğu iddia edilmez."
        data={sc?.byItem ?? []}
        columns={itemColumns}
        isLoading={query.isLoading}
        emptyLabel="Rafta bitmiş mal yok"
      />

      <DetailTable
        title="En eski toplar"
        description="Raftaki en uzun süredir bekleyen 25 top."
        data={sc?.oldest ?? []}
        columns={oldColumns}
        isLoading={query.isLoading}
        emptyLabel="Yaş çıpası olan top yok"
      />
    </ReportPageLayout>
  );
}
