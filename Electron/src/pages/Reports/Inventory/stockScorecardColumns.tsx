// Stok & Ölü Stok — "Genel" sekmesinin tablo kolonları.
import type { ColumnDef } from "@tanstack/react-table";
import { fmtInt, fmtNum, fmtPercent } from "../_components/formatters";
import type { StockScorecard } from "./stockScorecard";

type ItemRow = StockScorecard["byItem"][number];
type OldRow = StockScorecard["oldest"][number];

const ageTone = (d: number | null) => (d === null ? "" : d > 90 ? "text-destructive" : d > 30 ? "text-warning" : "");

export const itemColumns: ColumnDef<ItemRow, unknown>[] = [
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

export const oldColumns: ColumnDef<OldRow, unknown>[] = [
  { accessorKey: "barcode", header: "Barkod", cell: ({ getValue }) => (getValue() as string) ?? "—" },
  {
    id: "spec",
    header: "Kumaş / Renk",
    meta: { exportValue: (r: OldRow) => [r.itemName, r.colorName].filter(Boolean).join(" · ") },
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
