// Yurtiçi / Yurtdışı Satış — sekme tabloları (müşteri · ülke · ürün · açık sipariş).
// Tutar ve birim fiyat aynı satırda: ayrı "fiyat" sekmesi yok (sadelik).
import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate, fmtNum } from "../_components/formatters";
import { amountText, avgPriceText, BUCKET_LABELS, pricedCoverageText, type BacklogRow, type MixBreakdownRow } from "./destinationMix";

const right = (label: string) => () => <div className="text-right">{label}</div>;
const num = (v: number) => <div className="text-right tabular-nums">{fmtNum(v)}</div>;

function breakdownColumns(labelHeader: string, extra?: "country" | "customerCount"): ColumnDef<MixBreakdownRow, unknown>[] {
  return [
    { accessorKey: "label", header: labelHeader },
    ...(extra === "country" ? [{ accessorKey: "country", header: "Ülke" } as ColumnDef<MixBreakdownRow, unknown>] : []),
    ...(extra === "customerCount"
      ? [{ accessorKey: "customerCount", header: right("Müşteri"), cell: ({ getValue }) => num(getValue() as number) } as ColumnDef<MixBreakdownRow, unknown>]
      : []),
    { accessorKey: "bucket", header: "Yön", cell: ({ getValue }) => BUCKET_LABELS[getValue() as MixBreakdownRow["bucket"]] },
    { accessorKey: "meters", header: right("Sevk (m)"), cell: ({ getValue }) => num(getValue() as number) },
    { id: "tutar", header: "Tutar", cell: ({ row }) => <span className={row.original.money.pricedLineCount === 0 ? "text-muted-foreground" : ""}>{amountText(row.original.money)}</span> },
    { id: "ort", header: "Ort. birim fiyat", cell: ({ row }) => avgPriceText(row.original.money) },
    { id: "kapsam", header: "Fiyat kapsamı", cell: ({ row }) => <span className="text-xs text-muted-foreground">{pricedCoverageText(row.original.money)}</span> },
  ];
}

export const customerColumns = breakdownColumns("Müşteri", "country");
export const countryColumns = breakdownColumns("Ülke", "customerCount");
export const itemColumns = breakdownColumns("Ürün");

export const backlogExportColumns: ColumnDef<BacklogRow, unknown>[] = [
  { accessorKey: "customerName", header: "Müşteri" },
  { accessorKey: "openQty", header: right("Açık (m)"), cell: ({ getValue }) => num(getValue() as number) },
  { accessorKey: "overdueQty", header: right("Termini geçen (m)"), cell: ({ getValue }) => num(getValue() as number) },
  { accessorKey: "earliestDeadline", header: "En yakın termin", cell: ({ getValue }) => fmtDate(getValue() as string | null) },
  {
    id: "tutar",
    header: "Açık tutar",
    cell: ({ row }) => (row.original.openAmount > 0 ? `${row.original.currency} ${fmtNum(row.original.openAmount)}` : <span className="text-muted-foreground">fiyat girilmemiş</span>),
  },
];
