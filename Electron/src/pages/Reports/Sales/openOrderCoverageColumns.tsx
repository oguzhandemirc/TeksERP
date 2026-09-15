// Açık Sipariş Karşılanma tablolarının kolon tanımları — sayfadan AYRI dosyada:
// kolon listesi sayfa gövdesini şişiriyordu, okunurluk sınırı (200 satır) bu
// tanımlarla doluyordu.
import type { ColumnDef } from "@tanstack/react-table";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import { COVERAGE_STATE_LABEL, type CoverageBucketRow, type CoverageLineRow, type CoverageState } from "./openOrderCoverage";

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

export const bucketColumns = (labelHeader: string): ColumnDef<CoverageBucketRow, unknown>[] => [
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

export const lineColumns: ColumnDef<CoverageLineRow, unknown>[] = [
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
