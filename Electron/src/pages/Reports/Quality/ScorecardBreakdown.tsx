import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailTable } from "../_components";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import type { QualityScorecard, ScorecardBreakdownRow } from "./service";

const UNGRADED = "__UNGRADED__";

/** Δ rozeti — yön RENKLE değil İŞARETLE de anlatılır (renk körlüğü + gri baskı). */
function Delta({ now, prev }: { now: number; prev: number | undefined }) {
  if (prev === undefined) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return <span className="text-muted-foreground">±0</span>;
  const up = d > 0;
  return (
    <span className={up ? "text-success" : "text-destructive"}>
      {up ? "▲" : "▼"} {fmtNum(Math.abs(d))}
    </span>
  );
}

interface Props {
  title: string;
  description: string;
  labelHeader: string;
  rows: ScorecardBreakdownRow[];
  sc: QualityScorecard;
  hasCompare: boolean;
  isLoading?: boolean;
}

/**
 * Kırılım tablosu (kumaş / renk / fason) — üçü de aynı bileşen.
 *
 * Kalite kolonları KATALOG sırasında ve yalnız dönemde GÖRÜLEN kaliteler için
 * çizilir; hiç üretilmemiş bir kalitenin sıfır kolonu tabloyu okunmaz yapar.
 * `scorecardExport.gradeColumns` ile aynı kural — ekran ile indirilen dosya
 * aynı kolonları göstersin.
 */
export function ScorecardBreakdown({
  title,
  description,
  labelHeader,
  rows,
  sc,
  hasCompare,
  isLoading,
}: Props) {
  const columns = useMemo<ColumnDef<ScorecardBreakdownRow, unknown>[]>(() => {
    const seen = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.qtyByGrade)) seen.add(k);
    const grades = sc.gradeOrder.filter((g) => seen.has(g.code));

    const cols: ColumnDef<ScorecardBreakdownRow, unknown>[] = [
      { accessorKey: "label", header: labelHeader },
      {
        accessorKey: "rollCount",
        header: () => <div className="text-right">Top</div>,
        cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtInt(getValue() as number)}</div>,
      },
      {
        accessorKey: "totalQty",
        header: () => <div className="text-right">Toplam</div>,
        cell: ({ getValue }) => <div className="text-right tabular-nums">{fmtNum(getValue() as number)} m</div>,
      },
      ...grades.map<ColumnDef<ScorecardBreakdownRow, unknown>>((g) => ({
        id: `g_${g.code}`,
        header: () => (
          <div className="text-right">{g.code === UNGRADED ? "Belirsiz" : g.name}</div>
        ),
        cell: ({ row }) => (
          <div className="text-right tabular-nums text-muted-foreground">
            {fmtNum(row.original.qtyByGrade[g.code] ?? 0)}
          </div>
        ),
      })),
      {
        accessorKey: "topGradePct",
        header: () => <div className="text-right">{sc.summary.topGrade?.name ?? "Üst kalite"} %</div>,
        cell: ({ row }) => (
          <div className="text-right font-medium tabular-nums">{fmtPercent(row.original.topGradePct)}</div>
        ),
      },
    ];

    if (hasCompare) {
      cols.push({
        id: "delta",
        header: () => <div className="text-right">Δ</div>,
        cell: ({ row }) => (
          <div className="text-right tabular-nums">
            <Delta now={row.original.topGradePct} prev={row.original.prevTopGradePct} />
          </div>
        ),
      });
    }
    return cols;
  }, [rows, sc.gradeOrder, sc.summary.topGrade?.name, labelHeader, hasCompare]);

  return (
    <DetailTable
      title={title}
      description={description}
      data={rows}
      columns={columns}
      isLoading={isLoading}
      emptyLabel="Bu dönemde üretimi biten top yok"
    />
  );
}
