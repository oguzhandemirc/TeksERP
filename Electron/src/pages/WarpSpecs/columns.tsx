import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { SortableHeader } from "@/components/data-table/SortableHeader";
import type { WarpSpec } from "./types";

/** Sayıyı Türkçe biçimde bas; boş/parse edilemez değer için tire. */
function num(v: string | number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("tr-TR", { maximumFractionDigits: digits }) : "—";
}

export const warpSpecColumns: ColumnDef<WarpSpec>[] = [
  {
    accessorKey: "code",
    header: () => <SortableHeader field="code" label="Kod" />,
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "name",
    header: () => <SortableHeader field="name" label="Çözgü kartı" />,
  },
  {
    id: "yarn",
    header: "Çözgü ipliği",
    cell: ({ row }) => {
      const y = row.original.yarnItem;
      if (!y) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="flex flex-col">
          <span>{y.name}</span>
          <span className="text-muted-foreground text-xs">
            <span className="font-mono">{y.code}</span>
            {y.linearDensityDen ? ` · ${num(y.linearDensityDen, 2)} den` : " · denye YOK"}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "endsCount",
    header: () => <SortableHeader field="endsCount" label="Tel adedi" />,
    cell: ({ row }) => <span className="tabular-nums">{num(row.original.endsCount)}</span>,
  },
  {
    id: "reed",
    header: "Tarak",
    cell: ({ row }) => {
      const { reedNo, endsPerDent, reedWidthCm } = row.original;
      if (!reedNo && !endsPerDent && !reedWidthCm) {
        return <span className="text-muted-foreground">—</span>;
      }
      return (
        <span className="text-xs tabular-nums">
          {reedNo ? `No ${num(reedNo, 2)}` : "—"}
          {endsPerDent ? ` · ${endsPerDent} tel/diş` : ""}
          {reedWidthCm ? ` · ${num(reedWidthCm, 2)} cm` : ""}
        </span>
      );
    },
  },
  {
    accessorKey: "isActive",
    header: "Durum",
    cell: ({ row }) =>
      row.original.isActive ? (
        <Badge variant="default">Aktif</Badge>
      ) : (
        <Badge variant="muted">Pasif</Badge>
      ),
  },
];
