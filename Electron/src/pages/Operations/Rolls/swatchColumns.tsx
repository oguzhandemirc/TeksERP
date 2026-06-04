import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { safeFormat } from "@/lib/format";
import type { Swatch } from "./swatchService";

export const swatchColumns: ColumnDef<Swatch>[] = [
  {
    accessorKey: "barcode",
    header: "Barkod",
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.barcode}</span>
    ),
  },
  {
    accessorKey: "cardNumber",
    header: "Kart No",
    cell: ({ row }) => (
      <Badge variant="outline" className="text-[10px]">
        {row.original.cardNumber}
      </Badge>
    ),
  },
  {
    id: "item",
    header: "Ürün",
    cell: ({ row }) => (
      <span className="text-xs font-medium">
        {row.original.item?.name ?? "—"}
      </span>
    ),
  },
  {
    id: "color",
    header: "Renk",
    cell: ({ row }) =>
      row.original.color ? (
        <span className="inline-flex items-center gap-1 text-xs">
          {row.original.color.hex && (
            <span
              className="h-2.5 w-2.5 rounded-full border border-black/10"
              style={{ backgroundColor: row.original.color.hex }}
            />
          )}
          {row.original.color.name}
        </span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
  },
  {
    accessorKey: "length",
    header: "Boy",
    cell: ({ row }) => (
      <div className="text-right">
        <span className="tabular-nums text-xs">
          {row.original.length != null
            ? row.original.length.toLocaleString("tr-TR", { maximumFractionDigits: 2 })
            : "—"}
        </span>
        <span className="ml-1 text-[10px] text-muted-foreground">cm</span>
      </div>
    ),
  },
  {
    accessorKey: "width",
    header: "En",
    cell: ({ row }) =>
      row.original.width != null ? (
        <span className="tabular-nums text-xs">{row.original.width} cm</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "createdAt",
    header: "Tarih",
    cell: ({ row }) => {
      const d = row.original.createdAt;
      return (
        <span className="text-xs tabular-nums leading-tight">
          {safeFormat(d, "dd.MM.yyyy")}
          <span className="ml-1 text-muted-foreground">{safeFormat(d, "HH:mm")}</span>
        </span>
      );
    },
  },
];
